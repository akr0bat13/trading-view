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

  return { bollinger, rsi, macd, vwap, williamsR, volume, volumeProfile, fvg };
})();

if (typeof module !== 'undefined') module.exports = Ind;
