// Pure indicator math. Input: bars [{time, open, high, low, close, volume}].
// Line outputs are [{time, value}] so they can go straight into setData().
const Ind = (() => {
  const line = (bars, vals) => bars.map((b, i) => vals[i] == null ? { time: b.time } : { time: b.time, value: vals[i] });

  function emaArr(src, n) {
    const k = 2 / (n + 1), out = [];
    let prev = null;
    src.forEach((v, i) => {
      if (v == null) return out.push(null);
      prev = prev == null ? v : v * k + prev * (1 - k);
      out.push(prev);
    });
    return out;
  }

  function bollinger(bars, n = 20, mult = 2) {
    const up = [], mid = [], lo = [];
    for (let i = 0; i < bars.length; i++) {
      if (i < n - 1) { up.push(null); mid.push(null); lo.push(null); continue; }
      let s = 0, s2 = 0;
      for (let j = i - n + 1; j <= i; j++) { s += bars[j].close; s2 += bars[j].close ** 2; }
      const m = s / n, sd = Math.sqrt(Math.max(0, s2 / n - m * m));
      mid.push(m); up.push(m + mult * sd); lo.push(m - mult * sd);
    }
    return { upper: line(bars, up), mid: line(bars, mid), lower: line(bars, lo) };
  }

  function rsi(bars, n = 14) {
    const out = [null];
    let ag = 0, al = 0;
    for (let i = 1; i < bars.length; i++) {
      const d = bars[i].close - bars[i - 1].close, g = Math.max(d, 0), l = Math.max(-d, 0);
      if (i <= n) { ag += g / n; al += l / n; out.push(i === n ? 100 - 100 / (1 + ag / (al || 1e-12)) : null); continue; }
      ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n;
      out.push(100 - 100 / (1 + ag / (al || 1e-12)));
    }
    return line(bars, out);
  }

  function macd(bars, f = 12, s = 26, sig = 9) {
    const c = bars.map(b => b.close), ef = emaArr(c, f), es = emaArr(c, s);
    const m = c.map((_, i) => i < s - 1 ? null : ef[i] - es[i]);
    const sg = emaArr(m, sig).map((v, i) => i < s + sig - 2 ? null : v);
    const h = m.map((v, i) => v == null || sg[i] == null ? null : v - sg[i]);
    return {
      macd: line(bars, m), signal: line(bars, sg),
      hist: bars.map((b, i) => h[i] == null ? { time: b.time } : { time: b.time, value: h[i], color: h[i] >= 0 ? 'rgba(38,166,154,0.6)' : 'rgba(239,83,80,0.6)' }),
    };
  }

  // Resets every UTC day on intraday bars; anchored to the first loaded bar on daily+.
  function vwap(bars) {
    const intraday = bars.length > 1 && bars[1].time - bars[0].time < 86400;
    let pv = 0, v = 0, day = null;
    return bars.map(b => {
      const d = Math.floor(b.time / 86400);
      if (intraday && d !== day) { pv = 0; v = 0; day = d; }
      const tp = (b.high + b.low + b.close) / 3;
      pv += tp * b.volume; v += b.volume;
      return { time: b.time, value: v ? pv / v : tp };
    });
  }

  function williamsR(bars, n = 14) {
    return line(bars, bars.map((b, i) => {
      if (i < n - 1) return null;
      let hh = -Infinity, ll = Infinity;
      for (let j = i - n + 1; j <= i; j++) { hh = Math.max(hh, bars[j].high); ll = Math.min(ll, bars[j].low); }
      return hh === ll ? -50 : -100 * (hh - b.close) / (hh - ll);
    }));
  }

  function volume(bars) {
    return bars.map(b => ({ time: b.time, value: b.volume, color: b.close >= b.open ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)' }));
  }

  // Volume by price over the given bars, split into up/down volume, plus POC and 70% value area.
  function volumeProfile(bars, nBins = 24) {
    if (!bars.length) return null;
    let lo = Infinity, hi = -Infinity;
    bars.forEach(b => { lo = Math.min(lo, b.low); hi = Math.max(hi, b.high); });
    if (hi === lo) hi = lo + 1e-9;
    const step = (hi - lo) / nBins;
    const bins = Array.from({ length: nBins }, (_, i) => ({ lo: lo + i * step, hi: lo + (i + 1) * step, up: 0, down: 0 }));
    bars.forEach(b => {
      // spread the bar's volume evenly over the bins its range touches
      const a = Math.min(nBins - 1, Math.floor((b.low - lo) / step)), z = Math.min(nBins - 1, Math.floor((b.high - lo) / step));
      const share = b.volume / (z - a + 1), key = b.close >= b.open ? 'up' : 'down';
      for (let i = a; i <= z; i++) bins[i][key] += share;
    });
    const tot = bins.map(x => x.up + x.down), all = tot.reduce((s, x) => s + x, 0);
    let poc = tot.indexOf(Math.max(...tot)), a = poc, z = poc, acc = tot[poc];
    while (acc < all * 0.7 && (a > 0 || z < nBins - 1)) {
      const below = a > 0 ? tot[a - 1] : -1, above = z < nBins - 1 ? tot[z + 1] : -1;
      if (above >= below) acc += tot[++z]; else acc += tot[--a];
    }
    return { bins, max: Math.max(...tot), poc: (bins[poc].lo + bins[poc].hi) / 2, vah: bins[z].hi, val: bins[a].lo };
  }

  // 3-candle fair value gaps. Each gap extends right until price trades back through it.
  function fvg(bars) {
    const gaps = [];
    for (let i = 2; i < bars.length; i++) {
      const a = bars[i - 2], c = bars[i];
      if (c.low > a.high) gaps.push({ from: a.time, top: c.low, bottom: a.high, bull: true, i });
      else if (c.high < a.low) gaps.push({ from: a.time, top: a.low, bottom: c.high, bull: false, i });
    }
    gaps.forEach(g => {
      for (let j = g.i + 1; j < bars.length; j++) {
        if (g.bull ? bars[j].low <= g.bottom : bars[j].high >= g.top) { g.to = bars[j].time; break; }
      }
    });
    return gaps;
  }

  const smaArr = (src, n) => src.map((_, i) => {
    if (i < n - 1) return null;
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += src[j];
    return s / n;
  });
  const sma = (bars, n) => line(bars, smaArr(bars.map(b => b.close), n));
  const ema = (bars, n) => line(bars, emaArr(bars.map(b => b.close), n).map((v, i) => i < n - 1 ? null : v));

  // Wilder's smoothing (RMA), used by ATR/ADX
  function rmaArr(src, n) {
    const out = [];
    let prev = null, seed = 0;
    src.forEach((v, i) => {
      if (i < n) { seed += v; out.push(i === n - 1 ? (prev = seed / n) : null); return; }
      out.push(prev = (prev * (n - 1) + v) / n);
    });
    return out;
  }
  const trArr = bars => bars.map((b, i) => i ? Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)) : b.high - b.low);
  const atrArr = (bars, n) => rmaArr(trArr(bars), n);
  const atr = (bars, n = 14) => line(bars, atrArr(bars, n));

  const hh = (bars, i, n, k = 'high') => { let m = -Infinity; for (let j = Math.max(0, i - n + 1); j <= i; j++) m = Math.max(m, bars[j][k]); return m; };
  const ll = (bars, i, n, k = 'low') => { let m = Infinity; for (let j = Math.max(0, i - n + 1); j <= i; j++) m = Math.min(m, bars[j][k]); return m; };

  // Supertrend: one line, green below price in uptrend, red above in downtrend
  function supertrend(bars, n = 10, mult = 3) {
    const a = atrArr(bars, n), out = [];
    let up = null, dn = null, trend = 1;
    bars.forEach((b, i) => {
      if (a[i] == null) return out.push({ time: b.time });
      const mid = (b.high + b.low) / 2, bu = mid - mult * a[i], bd = mid + mult * a[i], pc = bars[i - 1].close;
      up = up != null && pc > up ? Math.max(bu, up) : bu;
      dn = dn != null && pc < dn ? Math.min(bd, dn) : bd;
      if (trend === -1 && b.close > dn) trend = 1; else if (trend === 1 && b.close < up) trend = -1;
      out.push({ time: b.time, value: trend === 1 ? up : dn, color: trend === 1 ? '#26a69a' : '#ef5350' });
    });
    return out;
  }

  function psar(bars, step = 0.02, max = 0.2) {
    if (bars.length < 2) return line(bars, bars.map(() => null));
    let up = bars[1].close >= bars[0].close, sar = up ? bars[0].low : bars[0].high, ep = up ? bars[1].high : bars[1].low, af = step;
    const out = [null];
    for (let i = 1; i < bars.length; i++) {
      const b = bars[i];
      sar = sar + af * (ep - sar);
      if (up) {
        sar = Math.min(sar, bars[i - 1].low, bars[Math.max(0, i - 2)].low);
        if (b.low < sar) { up = false; sar = ep; ep = b.low; af = step; }
        else if (b.high > ep) { ep = b.high; af = Math.min(max, af + step); }
      } else {
        sar = Math.max(sar, bars[i - 1].high, bars[Math.max(0, i - 2)].high);
        if (b.high > sar) { up = true; sar = ep; ep = b.high; af = step; }
        else if (b.low < ep) { ep = b.low; af = Math.min(max, af + step); }
      }
      out.push(sar);
    }
    return line(bars, out);
  }

  // Ichimoku (9, 26, 52). Cloud spans are shifted 26 bars forward.
  // ponytail: the last 26 projected cloud bars (beyond the newest candle) aren't drawn.
  function ichimoku(bars) {
    const mid = (i, n) => i < n - 1 ? null : (hh(bars, i, n) + ll(bars, i, n)) / 2;
    const tenkan = bars.map((_, i) => mid(i, 9)), kijun = bars.map((_, i) => mid(i, 26));
    const a = tenkan.map((t, i) => t == null || kijun[i] == null ? null : (t + kijun[i]) / 2);
    const b = bars.map((_, i) => mid(i, 52));
    // shift spans forward 26 bars within the loaded range
    const sh = arr => arr.map((_, i) => i >= 26 ? arr[i - 26] : null);
    return { tenkan: line(bars, tenkan), kijun: line(bars, kijun), spanA: line(bars, sh(a)), spanB: line(bars, sh(b)) };
  }

  function keltner(bars, n = 20, mult = 2) {
    const m = emaArr(bars.map(b => b.close), n), a = atrArr(bars, n);
    const at = (f) => line(bars, m.map((v, i) => i < n - 1 || a[i] == null ? null : f(v, a[i])));
    return { upper: at((v, x) => v + mult * x), mid: at(v => v), lower: at((v, x) => v - mult * x) };
  }

  function donchian(bars, n = 20) {
    const ok = i => i >= n - 1;
    return {
      upper: line(bars, bars.map((_, i) => ok(i) ? hh(bars, i, n) : null)),
      lower: line(bars, bars.map((_, i) => ok(i) ? ll(bars, i, n) : null)),
    };
  }

  function stochastic(bars, n = 14, kS = 3, dS = 3) {
    const raw = bars.map((b, i) => {
      if (i < n - 1) return null;
      const h = hh(bars, i, n), l = ll(bars, i, n);
      return h === l ? 50 : 100 * (b.close - l) / (h - l);
    });
    const k = smaOfNullable(raw, kS), d = smaOfNullable(k, dS);
    return { k: line(bars, k), d: line(bars, d) };
  }
  function smaOfNullable(src, n) {
    return src.map((_, i) => {
      if (i < n - 1) return null;
      let s = 0;
      for (let j = i - n + 1; j <= i; j++) { if (src[j] == null) return null; s += src[j]; }
      return s / n;
    });
  }

  function cci(bars, n = 20) {
    const tp = bars.map(b => (b.high + b.low + b.close) / 3), m = smaArr(tp, n);
    return line(bars, tp.map((v, i) => {
      if (m[i] == null) return null;
      let md = 0;
      for (let j = i - n + 1; j <= i; j++) md += Math.abs(tp[j] - m[i]);
      md /= n;
      return md ? (v - m[i]) / (0.015 * md) : 0;
    }));
  }

  function obv(bars) {
    let v = 0;
    return bars.map((b, i) => {
      if (i) v += b.close > bars[i - 1].close ? b.volume : b.close < bars[i - 1].close ? -b.volume : 0;
      return { time: b.time, value: v };
    });
  }

  function mfi(bars, n = 14) {
    const tp = bars.map(b => (b.high + b.low + b.close) / 3);
    return line(bars, bars.map((_, i) => {
      if (i < n) return null;
      let pos = 0, neg = 0;
      for (let j = i - n + 1; j <= i; j++) {
        const f = tp[j] * bars[j].volume;
        if (tp[j] > tp[j - 1]) pos += f; else if (tp[j] < tp[j - 1]) neg += f;
      }
      return neg ? 100 - 100 / (1 + pos / neg) : 100;
    }));
  }

  function adx(bars, n = 14) {
    const pdm = [0], ndm = [0];
    for (let i = 1; i < bars.length; i++) {
      const u = bars[i].high - bars[i - 1].high, d = bars[i - 1].low - bars[i].low;
      pdm.push(u > d && u > 0 ? u : 0); ndm.push(d > u && d > 0 ? d : 0);
    }
    const tr = rmaArr(trArr(bars), n), sp = rmaArr(pdm, n), sn = rmaArr(ndm, n);
    const pdi = tr.map((t, i) => t ? 100 * sp[i] / t : null), ndi = tr.map((t, i) => t ? 100 * sn[i] / t : null);
    const dx = pdi.map((p, i) => p == null || ndi[i] == null ? 0 : (p + ndi[i] ? 100 * Math.abs(p - ndi[i]) / (p + ndi[i]) : 0));
    const firstDx = n; // dx is meaningful from bar n on
    const ax = rmaArr(dx.slice(firstDx), n);
    const adxArr = bars.map((_, i) => i < firstDx ? null : ax[i - firstDx]);
    return { adx: line(bars, adxArr), pdi: line(bars, pdi), ndi: line(bars, ndi) };
  }

  return {
    bollinger, rsi, macd, vwap, williamsR, volume, volumeProfile, fvg,
    sma, ema, atr, supertrend, psar, ichimoku, keltner, donchian, stochastic, cci, obv, mfi, adx,
  };
})();

if (typeof module !== 'undefined') module.exports = Ind;
