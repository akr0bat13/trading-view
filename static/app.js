const LC = LightweightCharts;
const COUNTS = [1, 2, 4, 6, 8];
const LAYOUT = { 1: [1, 1], 2: [2, 1], 4: [2, 2], 6: [3, 2], 8: [4, 2] }; // [cols, rows]
const DEFAULT_PANES = [
  ['crypto', 'BTC', '15m'], ['crypto', 'ETH', '15m'], ['india', 'RELIANCE', '15m'], ['us', 'AAPL', '15m'],
  ['crypto', 'SOL', '1h'], ['us', 'TSLA', '15m'], ['india', 'TCS', '1d'], ['crypto', 'ETH', '1d'],
].map(([source, symbol, tf]) => ({ source, symbol, tf, ind: ['vol'] }));
// Indicator table. series: ['line'|'hist', options]; calc returns one data array per series.
// pane: true = own sub-pane below the price chart. Add an indicator = add a row here.
const L = (color, o = {}) => ['line', { color, ...o }], H = (o = {}) => ['hist', o];
const ema = (n, c) => ({ key: 'ema' + n, label: `EMA ${n}`, group: 'Moving averages', series: [L(c)], calc: b => [Ind.ema(b, n)] });
const sma = (n, c) => ({ key: 'sma' + n, label: `SMA ${n}`, group: 'Moving averages', series: [L(c)], calc: b => [Ind.sma(b, n)] });
const BAND = 'rgba(41,98,255,0.6)', MID = 'rgba(255,152,0,0.6)';
const INDICATORS = [
  ema(9, '#f7c948'), ema(21, '#4dd0e1'), ema(50, '#ff9800'), ema(200, '#e91e63'),
  sma(20, '#90caf9'), sma(50, '#ffcc80'), sma(200, '#f48fb1'),
  { key: 'vol', label: 'Volume', group: 'Overlays', series: [H({ priceScaleId: 'vol', priceFormat: { type: 'volume' } })], calc: b => [Ind.volume(b)] },
  { key: 'bb', label: 'Bollinger Bands (20, 2)', group: 'Overlays', series: [L(BAND), L(MID), L(BAND)], calc: b => { const x = Ind.bollinger(b); return [x.upper, x.mid, x.lower]; } },
  { key: 'kc', label: 'Keltner Channels (20, 2)', group: 'Overlays', series: [L('#26c6da99'), L('#26c6da55'), L('#26c6da99')], calc: b => { const x = Ind.keltner(b); return [x.upper, x.mid, x.lower]; } },
  { key: 'dc', label: 'Donchian Channels (20)', group: 'Overlays', series: [L('#9575cd'), L('#9575cd')], calc: b => { const x = Ind.donchian(b); return [x.upper, x.lower]; } },
  { key: 'vwap', label: 'VWAP', group: 'Overlays', series: [L('#e040fb', { lineWidth: 2 })], calc: b => [Ind.vwap(b)] },
  { key: 'st', label: 'Supertrend (10, 3)', group: 'Overlays', series: [L('#26a69a', { lineWidth: 2 })], calc: b => [Ind.supertrend(b)] },
  { key: 'psar', label: 'Parabolic SAR', group: 'Overlays', series: [L('rgba(255,235,59,0.7)', { lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 1 })], calc: b => [Ind.psar(b)] },
  { key: 'ichi', label: 'Ichimoku Cloud', group: 'Overlays', series: [L('#2962ff'), L('#b71c1c'), L('#4caf5099'), L('#f4433699')],
    calc: b => { const x = Ind.ichimoku(b); return [x.tenkan, x.kijun, x.spanA, x.spanB]; } },
  { key: 'rsi', label: 'RSI (14)', group: 'Oscillators', pane: true, levels: [70, 30], series: [L('#b388ff')], calc: b => [Ind.rsi(b)] },
  { key: 'macd', label: 'MACD (12, 26, 9)', group: 'Oscillators', pane: true, series: [H(), L('#2962ff'), L('#ff6d00')], calc: b => { const m = Ind.macd(b); return [m.hist, m.macd, m.signal]; } },
  { key: 'stoch', label: 'Stochastic (14, 3, 3)', group: 'Oscillators', pane: true, levels: [80, 20], series: [L('#2962ff'), L('#ff6d00')], calc: b => { const x = Ind.stochastic(b); return [x.k, x.d]; } },
  { key: 'willr', label: 'Williams %R (14)', group: 'Oscillators', pane: true, levels: [-20, -80], series: [L('#00bcd4')], calc: b => [Ind.williamsR(b)] },
  { key: 'cci', label: 'CCI (20)', group: 'Oscillators', pane: true, levels: [100, -100], series: [L('#8d6e63')], calc: b => [Ind.cci(b)] },
  { key: 'mfi', label: 'MFI (14)', group: 'Oscillators', pane: true, levels: [80, 20], series: [L('#66bb6a')], calc: b => [Ind.mfi(b)] },
  { key: 'adx', label: 'ADX / DMI (14)', group: 'Oscillators', pane: true, levels: [25], series: [L('#ff9800', { lineWidth: 2 }), L('#26a69a'), L('#ef5350')],
    calc: b => { const x = Ind.adx(b); return [x.adx, x.pdi, x.ndi]; } },
  { key: 'atr', label: 'ATR (14)', group: 'Oscillators', pane: true, series: [L('#ef9a9a')], calc: b => [Ind.atr(b)] },
  { key: 'obv', label: 'OBV', group: 'Oscillators', pane: true, series: [L('#4fc3f7')], calc: b => [Ind.obv(b)] },
  { key: 'vp', label: 'Volume Profile', group: 'PRO', canvas: true },
  { key: 'fvg', label: 'Fair Value Gap', group: 'PRO', canvas: true },
];
const POLL_MS = 15000;

// UI state is kept in JSON files by the Flask backend (state/<name>.json), debounced saves.
const State = {
  data: {}, timers: {},
  async load(...names) {
    await Promise.all(names.map(async n => { try { this.data[n] = await (await fetch('/api/state/' + n)).json(); } catch { this.data[n] = null; } }));
  },
  save(name) {
    clearTimeout(this.timers[name]);
    this.timers[name] = setTimeout(() => fetch('/api/state/' + name, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(this.data[name]),
    }).catch(() => { }), 300);
  },
};
const DEFAULT_WATCH = [['crypto', 'BTC'], ['crypto', 'ETH'], ['crypto', 'SOL'], ['crypto', 'HYPE'], ['us', 'AAPL'], ['us', 'TSLA'], ['us', 'NVDA'],
  ['us', 'SPY'], ['india', 'RELIANCE'], ['india', 'TCS'], ['india', '^NSEI']].map(([source, symbol]) => ({ source, symbol }));

let META; // /api/sources
let S;    // settings: {count, active, panes: [cfg x8], watch: [{source, symbol}], wl}
const panes = [];
const saveConfigs = () => State.save('settings');
const activePane = () => panes[S.active] || panes[0];

// ---------- Hyperliquid websocket (one shared connection) ----------
const HL = {
  ws: null, subs: new Map(), // "COIN|tf" -> Set(callback)
  key: (coin, tf) => coin + '|' + tf,
  connect() {
    const ws = this.ws = new WebSocket('wss://api.hyperliquid.xyz/ws');
    ws.onopen = () => {
      setBadge('hl', 'HL live', true);
      for (const k of this.subs.keys()) this.send('subscribe', k);
      ws.send('{"method":"subscribe","subscription":{"type":"allMids"}}');
    };
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.channel === 'allMids') return this.onMids?.(m.data.mids);
      if (m.channel !== 'candle') return;
      const c = m.data, bar = { time: c.t / 1000, open: +c.o, high: +c.h, low: +c.l, close: +c.c, volume: +c.v };
      this.subs.get(this.key(c.s, c.i))?.forEach(cb => cb(bar));
    };
    ws.onclose = () => { setBadge('hl', 'HL offline', false); setTimeout(() => this.connect(), 3000); };
  },
  send(method, k) {
    const [coin, interval] = k.split('|');
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ method, subscription: { type: 'candle', coin, interval } }));
  },
  on(coin, tf, cb) {
    const k = this.key(coin, tf);
    if (!this.subs.has(k)) { this.subs.set(k, new Set()); this.send('subscribe', k); }
    this.subs.get(k).add(cb);
    return () => {
      const s = this.subs.get(k); s.delete(cb);
      if (!s.size) { this.subs.delete(k); this.send('unsubscribe', k); }
    };
  },
};
setInterval(() => HL.ws?.readyState === 1 && HL.ws.send('{"method":"ping"}'), 30000); // HL drops idle sockets after 60s

// ---------- market status ----------
function marketOpen(tz, open, close) { // ponytail: weekdays + hours only, exchange holidays ignored
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  const mins = +p.hour * 60 + +p.minute;
  return !['Sat', 'Sun'].includes(p.weekday) && mins >= open && mins < close;
}
const MARKETS = { us: ['US', 'America/New_York', 570, 960], india: ['India', 'Asia/Kolkata', 555, 930] };
function setBadge(id, text, on) {
  let el = document.getElementById('badge-' + id);
  if (!el) { el = document.createElement('span'); el.id = 'badge-' + id; el.className = 'badge'; document.getElementById('badges').append(el); }
  el.textContent = text; el.classList.toggle('open', on); el.classList.toggle('closed', !on);
}
function updateMarketBadges() {
  for (const [id, [name, ...hours]] of Object.entries(MARKETS)) {
    const open = marketOpen(...hours);
    setBadge(id, `${name} market ${open ? 'open' : 'closed'}`, open);
  }
}

// ---------- formatting ----------
const pad = n => String(n).padStart(2, '0');
const MON = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
function tickFmt(t, type) { // axis labels in the browser's local time
  const d = new Date(t * 1000);
  return [d.getFullYear(), MON[d.getMonth()], d.getDate(), `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`][type];
}
const decimals = p => p >= 100 ? 2 : p >= 1 ? 4 : p >= 0.01 ? 6 : 8;
const fmtPrice = p => p.toLocaleString(undefined, { minimumFractionDigits: Math.min(decimals(p), 2), maximumFractionDigits: decimals(p) });

// ---------- pane ----------
class Pane {
  constructor(cfg) {
    this.cfg = cfg; this.bars = []; this.ind = {}; this.stop = () => { };
    const el = this.el = document.createElement('section');
    el.className = 'pane';
    el.innerHTML = `
      <div class="bar">
        <span class="title"><b></b><span class="meta"></span></span>
        <span class="ohlc"></span>
        <span class="px">—</span><span class="chg"></span>
      </div>
      <div class="chart-wrap"><div class="chart"></div><canvas></canvas><div class="legend"></div><div class="msg"></div></div>`;
    const $ = s => el.querySelector(s);
    [this.bar, this.px, this.chg, this.msg, this.canvas, this.legend, this.ohlc] = ['.bar', '.px', '.chg', '.msg', 'canvas', '.legend', '.ohlc'].map($);
    $('.title').onclick = () => UI.openSymbolSearch();
    el.addEventListener('pointerdown', () => setActive(panes.indexOf(this)), true);

    this.chart = LC.createChart($('.chart'), {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#b2b5be', fontSize: 11, panes: { separatorColor: '#2a2e39' } },
      grid: { vertLines: { color: '#1e222d' }, horzLines: { color: '#1e222d' } },
      crosshair: { mode: LC.CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#2a2e39' },
      timeScale: { borderColor: '#2a2e39', timeVisible: true, tickMarkFormatter: tickFmt },
      localization: { timeFormatter: t => new Date(t * 1000).toLocaleString() },
    });
    this.candles = this.chart.addSeries(LC.CandlestickSeries, {
      upColor: '#089981', downColor: '#f23645', borderVisible: false, wickUpColor: '#089981', wickDownColor: '#f23645',
    });
    const redraw = () => this.scheduleDraw();
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
    this.chart.subscribeCrosshairMove(p => { this.hovering = p.time != null; this.showOhlc(p.time != null ? p.seriesData.get(this.candles) : null); redraw(); });
    this.chart.timeScale().subscribeSizeChange(redraw);
    Draw.attach(this);
    this.applyScale();
    this.buildIndicators();
    this.load();
  }

  setSymbol(source, symbol) { Object.assign(this.cfg, { source, symbol: normSymbol(source, symbol) }); this.load(); }
  setTf(tf) { this.cfg.tf = tf; this.load(); }
  toggleInd(key) {
    const i = this.cfg.ind.indexOf(key);
    i < 0 ? this.cfg.ind.push(key) : this.cfg.ind.splice(i, 1);
    saveConfigs(); this.buildIndicators();
  }
  applyScale() {
    this.candles.priceScale().applyOptions({ invertScale: !!this.cfg.invert, mode: this.cfg.log ? LC.PriceScaleMode.Logarithmic : LC.PriceScaleMode.Normal });
  }
  toggleScale(k) { this.cfg[k] = !this.cfg[k]; saveConfigs(); this.applyScale(); this.scheduleDraw(); }
  resetView() {
    this.chart.timeScale().fitContent();
    this.chart.panes().forEach(p => p.getSeries().forEach(s => s.priceScale().applyOptions({ autoScale: true })));
  }

  // OHLC of the hovered (or last) bar, like TradingView's legend
  showOhlc(b) {
    b = b || this.bars.at(-1);
    if (!b) return (this.ohlc.textContent = '');
    const f = fmtPrice, cls = b.close >= b.open ? 'up' : 'down';
    this.ohlc.innerHTML = ['O', 'H', 'L', 'C'].map((k, i) => `${k}<i class="${cls}">${f([b.open, b.high, b.low, b.close][i])}</i>`).join('');
  }

  drawKey() { return `${this.cfg.source}:${this.cfg.symbol}`; }

  async load() {
    saveConfigs();
    this.stop();
    this.pending = null;
    const { source, symbol, tf } = this.cfg, token = this.token = {};
    this.el.querySelector('.title b').textContent = symbol;
    this.el.querySelector('.title .meta').textContent = `${tf} · ${META.sources[source].label}`;
    if (this === activePane()) UI.syncHeader();
    this.msg.textContent = `Loading ${symbol} ${tf}…`;
    this.px.textContent = '—'; this.chg.textContent = '';
    let bars;
    try {
      bars = await this.fetchBars();
    } catch (e) {
      if (token === this.token) { this.msg.textContent = `${symbol}: ${e.message}`; this.bars = []; this.candles.setData([]); this.refresh(); }
      return;
    }
    if (token !== this.token) return; // a newer load() started meanwhile
    if (!bars.length) { this.msg.textContent = `No data for ${symbol} ${tf}`; }
    else this.msg.textContent = '';
    this.bars = bars;
    const prec = decimals(bars.at(-1)?.close ?? 1);
    this.candles.applyOptions({ priceFormat: { type: 'price', precision: prec, minMove: 10 ** -prec } });
    this.candles.setData(bars);
    this.chart.timeScale().fitContent();
    this.chart.timeScale().applyOptions({ rightOffset: 5 });
    this.refresh(false);
    this.showOhlc();

    if (META.sources[source].live === 'hyperliquid') {
      this.stop = HL.on(symbol, tf, bar => this.onBar(bar));
    } else {
      const id = setInterval(async () => {
        if (document.hidden) return;
        try { (await this.fetchBars()).filter(b => b.time >= (this.bars.at(-1)?.time ?? 0)).forEach(b => this.onBar(b)); } catch { }
      }, POLL_MS);
      this.stop = () => clearInterval(id);
    }
  }

  async fetchBars() {
    const { source, symbol, tf } = this.cfg;
    const r = await fetch(`/api/candles?${new URLSearchParams({ source, symbol, tf })}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }

  onBar(bar) {
    const last = this.bars.at(-1);
    if (last && bar.time < last.time) return;
    if (last && bar.time === last.time) this.bars[this.bars.length - 1] = bar; else this.bars.push(bar);
    this.candles.update(bar);
    this.msg.textContent = '';
    if (!this.hovering) this.showOhlc();
    this.refresh(true);
  }

  // ticker bar + indicators (throttled to ~2/s so a busy websocket doesn't recompute every tick)
  refresh(flash) {
    const b = this.bars, last = b.at(-1);
    if (last) {
      const prev = this.lastPx;
      this.px.textContent = fmtPrice(last.close);
      const pc = prevClose(b), ch = last.close - pc, pct = pc ? ch / pc * 100 : 0;
      this.chg.textContent = `${ch >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
      this.chg.className = 'chg ' + (ch >= 0 ? 'up' : 'down');
      if (flash && prev != null && last.close !== prev) {
        const dir = last.close > prev ? 'up' : 'down';
        this.px.className = 'px ' + dir;
        this.bar.classList.remove('flash-up', 'flash-down');
        void this.bar.offsetWidth; // restart the CSS animation
        this.bar.classList.add('flash-' + dir);
      }
      this.lastPx = last.close;
    }
    if (this.indTimer) return;
    this.indTimer = setTimeout(() => { this.indTimer = null; this.computeIndicators(); }, flash ? 500 : 0);
  }

  buildIndicators() {
    Object.values(this.ind).flat().forEach(s => this.chart.removeSeries(s));
    this.ind = {};
    while (this.chart.panes().length > 1) this.chart.removePane(this.chart.panes().length - 1);
    const on = this.cfg.ind, quiet = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
    // volume: overlay at the bottom of the price pane, like TradingView
    this.candles.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: on.includes('vol') ? 0.22 : 0.06 } });
    let pane = 0;
    for (const d of INDICATORS) {
      if (!on.includes(d.key) || d.canvas) continue;
      const p = d.pane ? ++pane : 0;
      this.ind[d.key] = d.series.map(([type, o]) => this.chart.addSeries(type === 'hist' ? LC.HistogramSeries : LC.LineSeries, { lineWidth: 1, ...quiet, ...o }, p));
      (d.levels || []).forEach(price => this.ind[d.key][0].createPriceLine({ price, color: '#555', lineStyle: 2, axisLabelVisible: false }));
    }
    if (this.ind.vol) this.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    this.chart.panes().forEach((p, i) => p.setStretchFactor(i ? 1 : 3));
    this.legend.innerHTML = INDICATORS.filter(d => on.includes(d.key)).map(d =>
      `<span class="row" data-k="${d.key}"><span class="sw" style="background:${d.series ? d.series.at(-1)[1].color || '#787b86' : '#f0b90b'}"></span>${d.label}<button title="Remove">✕</button></span>`).join('');
    this.legend.querySelectorAll('.row button').forEach(b => b.onclick = () => this.toggleInd(b.parentElement.dataset.k));
    this.computeIndicators();
  }

  computeIndicators() {
    for (const d of INDICATORS) {
      const series = this.ind[d.key];
      if (series) d.calc(this.bars).forEach((data, i) => series[i].setData(data));
    }
    this.fvgs = this.cfg.ind.includes('fvg') ? Ind.fvg(this.bars) : null;
    this.scheduleDraw();
  }

  scheduleDraw() {
    if (this.drawQueued) return;
    this.drawQueued = true;
    requestAnimationFrame(() => { this.drawQueued = false; this.draw(); });
  }

  // Volume Profile, Fair Value Gaps and drawings are painted on a canvas laid over the chart.
  draw() {
    const cv = this.canvas, dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    const ts = this.chart.timeScale(), plotW = ts.width(), plotH = this.chart.panes()[0].getHeight(), y = p => this.candles.priceToCoordinate(p);
    if (!this.bars.length || !plotW) return;
    g.save(); g.beginPath(); g.rect(0, 0, plotW, plotH); g.clip();

    if (this.fvgs) {
      const idx = new Map(this.bars.map((b, i) => [b.time, i]));
      for (const f of this.fvgs) {
        const x1 = ts.logicalToCoordinate(idx.get(f.from)), x2 = f.to ? ts.logicalToCoordinate(idx.get(f.to)) : plotW;
        const y1 = y(f.top), y2 = y(f.bottom);
        if (x1 == null || x2 == null || y1 == null || y2 == null || x2 < 0 || x1 > plotW) continue;
        g.fillStyle = f.bull ? (f.to ? '#26a69a22' : '#26a69a44') : (f.to ? '#ef535022' : '#ef535044');
        g.fillRect(x1, Math.min(y1, y2), Math.max(1, x2 - x1), Math.max(1, Math.abs(y2 - y1)));
      }
    }

    if (this.cfg.ind.includes('vp')) {
      const r = ts.getVisibleLogicalRange();
      const vis = r ? this.bars.slice(Math.max(0, Math.floor(r.from)), Math.ceil(r.to) + 1) : this.bars;
      const vp = Ind.volumeProfile(vis);
      if (vp && vp.max) {
        const maxW = plotW * 0.28;
        for (const bin of vp.bins) {
          const yt = y(bin.hi), yb = y(bin.lo);
          if (yt == null || yb == null) continue;
          const hgt = Math.max(1, yb - yt - 1), wu = (bin.up / vp.max) * maxW, wd = (bin.down / vp.max) * maxW;
          g.fillStyle = '#26a69a55'; g.fillRect(plotW - wu - wd, yt, wu, hgt);
          g.fillStyle = '#ef535055'; g.fillRect(plotW - wd, yt, wd, hgt);
        }
        g.font = '10px system-ui'; g.setLineDash([4, 3]);
        for (const [label, price, color] of [['POC', vp.poc, '#ffb300'], ['VAH', vp.vah, '#42a5f5'], ['VAL', vp.val, '#42a5f5']]) {
          const yy = y(price);
          if (yy == null) continue;
          g.strokeStyle = g.fillStyle = color;
          g.beginPath(); g.moveTo(0, yy); g.lineTo(plotW, yy); g.stroke();
          g.fillText(label, 4, yy - 3);
        }
      }
    }
    Draw.render(g, this, plotW, plotH);
    g.restore();
  }

  destroy() { this.stop(); this.token = null; this.chart.remove(); this.el.remove(); }
}

// change % reference: previous day's last close on intraday bars, previous bar otherwise
function prevClose(b) {
  const last = b.at(-1);
  if (b.length < 2) return last.open;
  if (b[1].time - b[0].time >= 86400) return b.at(-2).close;
  const day = new Date(last.time * 1000).toDateString();
  for (let i = b.length - 2; i >= 0; i--) if (new Date(b[i].time * 1000).toDateString() !== day) return b[i].close;
  return b[0].open;
}

const normSymbol = (source, s) => (s = s.trim(), source === 'crypto' && /^k[A-Z]/.test(s) ? s : s.toUpperCase()); // HL has kPEPE, kBONK...

// ---------- grid ----------
function setCount(n) {
  S.count = n; saveConfigs();
  document.querySelectorAll('#counts .tb').forEach(b => b.classList.toggle('on', +b.textContent === n));
  const [cols, rows] = LAYOUT[n], grid = document.getElementById('grid');
  grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  grid.classList.toggle('multi', n > 1);
  while (panes.length > n) panes.pop().destroy();
  while (panes.length < n) { const p = new Pane(S.panes[panes.length]); panes.push(p); grid.append(p.el); }
  setActive(Math.min(S.active || 0, n - 1));
}

function setActive(i) {
  if (i < 0 || panes[i]?.el.classList.contains('active')) return;
  const changed = S.active !== i;
  S.active = i;
  panes.forEach((p, j) => p.el.classList.toggle('active', j === i));
  UI.syncHeader();
  if (changed) saveConfigs();
}

async function init() {
  META = await (await fetch('/api/sources')).json();
  await State.load('settings', 'drawings');
  const old = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }; // pre-server-state settings
  S = State.data.settings || { count: old('tv.count', 4), panes: old('tv.panes', []) };
  S.panes = DEFAULT_PANES.map((d, i) => {
    const c = { ...d, ...(S.panes?.[i] || {}) };
    return META.sources[c.source] ? c : { ...d };
  });
  S.watch ||= DEFAULT_WATCH.filter(w => META.sources[w.source]);
  S.wl ??= true;
  State.data.settings = S;
  Draw.load(State.data.drawings);
  if (Object.values(META.sources).some(s => s.live === 'hyperliquid')) { setBadge('hl', 'HL connecting', false); HL.connect(); }
  updateMarketBadges(); setInterval(updateMarketBadges, 30000);
  UI.init();
  setCount(COUNTS.includes(S.count) ? S.count : 4);
}
document.addEventListener('DOMContentLoaded', init);
