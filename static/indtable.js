// Indicator table. One row per indicator TYPE; a chart can hold any number of instances of a type,
// each with its own params and color: {id, type, params: {n: 50}, color}.
//   series(color) -> [['line'|'hist', options], ...]    calc(bars, params) -> one data array per series
//   pane: true = own sub-pane under the price chart     single: only one instance per chart
// Add an indicator = add a row here + a calc function in indicators.js.
const L = (color, o = {}) => ['line', { color, ...o }], H = (o = {}) => ['hist', o];
const P = (k, label, def, step = 1) => ({ k, label, def, step });
const BAND = 'rgba(41,98,255,0.6)', MID = 'rgba(255,152,0,0.6)';
const MA_COLORS = ['#f7c948', '#4dd0e1', '#ff9800', '#e91e63', '#90caf9', '#f48fb1'];
const INDICATORS = [
  { type: 'sma', name: 'SMA', group: 'Moving averages', params: [P('n', 'Length', 50)], color: '#90caf9', series: c => [L(c)], calc: (b, p) => [Ind.sma(b, p.n)] },
  { type: 'ema', name: 'EMA', group: 'Moving averages', params: [P('n', 'Length', 21)], color: '#4dd0e1', series: c => [L(c)], calc: (b, p) => [Ind.ema(b, p.n)] },
  { type: 'wma', name: 'WMA', group: 'Moving averages', params: [P('n', 'Length', 20)], color: '#ff9800', series: c => [L(c)], calc: (b, p) => [Ind.wma(b, p.n)] },
  { type: 'vol', name: 'Volume', group: 'Overlays', single: true, series: () => [H({ priceScaleId: 'vol', priceFormat: { type: 'volume' } })], calc: b => [Ind.volume(b)] },
  { type: 'bb', name: 'Bollinger Bands', group: 'Overlays', params: [P('n', 'Length', 20), P('m', 'Multiplier', 2, 0.1)], color: BAND, series: c => [L(c), L(MID), L(c)],
    calc: (b, p) => { const x = Ind.bollinger(b, p.n, p.m); return [x.upper, x.mid, x.lower]; } },
  { type: 'kc', name: 'Keltner Channels', group: 'Overlays', params: [P('n', 'Length', 20), P('m', 'Multiplier', 2, 0.1)], color: '#26c6da99', series: c => [L(c), L('#26c6da55'), L(c)],
    calc: (b, p) => { const x = Ind.keltner(b, p.n, p.m); return [x.upper, x.mid, x.lower]; } },
  { type: 'dc', name: 'Donchian Channels', group: 'Overlays', params: [P('n', 'Length', 20)], color: '#9575cd', series: c => [L(c), L(c)],
    calc: (b, p) => { const x = Ind.donchian(b, p.n); return [x.upper, x.lower]; } },
  { type: 'vwap', name: 'VWAP', group: 'Overlays', single: true, color: '#e040fb', series: c => [L(c, { lineWidth: 2 })], calc: b => [Ind.vwap(b)] },
  { type: 'st', name: 'Supertrend', group: 'Overlays', params: [P('n', 'ATR length', 10), P('m', 'Factor', 3, 0.1)], series: () => [L('#26a69a', { lineWidth: 2 })], calc: (b, p) => [Ind.supertrend(b, p.n, p.m)] },
  { type: 'psar', name: 'Parabolic SAR', group: 'Overlays', params: [P('s', 'Step', 0.02, 0.01), P('m', 'Max', 0.2, 0.01)], color: 'rgba(255,235,59,0.7)',
    series: c => [L(c, { lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 1 })], calc: (b, p) => [Ind.psar(b, p.s, p.m)] },
  { type: 'ichi', name: 'Ichimoku Cloud', group: 'Overlays', single: true, series: () => [L('#2962ff'), L('#b71c1c'), L('#4caf5099'), L('#f4433699')],
    calc: b => { const x = Ind.ichimoku(b); return [x.tenkan, x.kijun, x.spanA, x.spanB]; } },
  { type: 'rsi', name: 'RSI', group: 'Oscillators', pane: true, levels: [70, 30], params: [P('n', 'Length', 14)], color: '#b388ff', series: c => [L(c)], calc: (b, p) => [Ind.rsi(b, p.n)] },
  { type: 'macd', name: 'MACD', group: 'Oscillators', pane: true, params: [P('f', 'Fast', 12), P('s', 'Slow', 26), P('g', 'Signal', 9)], series: () => [H(), L('#2962ff'), L('#ff6d00')],
    calc: (b, p) => { const m = Ind.macd(b, p.f, p.s, p.g); return [m.hist, m.macd, m.signal]; } },
  { type: 'stoch', name: 'Stochastic', group: 'Oscillators', pane: true, levels: [80, 20], params: [P('n', 'K length', 14), P('k', 'K smoothing', 3), P('d', 'D smoothing', 3)], series: () => [L('#2962ff'), L('#ff6d00')],
    calc: (b, p) => { const x = Ind.stochastic(b, p.n, p.k, p.d); return [x.k, x.d]; } },
  { type: 'willr', name: 'Williams %R', group: 'Oscillators', pane: true, levels: [-20, -80], params: [P('n', 'Length', 14)], color: '#00bcd4', series: c => [L(c)], calc: (b, p) => [Ind.williamsR(b, p.n)] },
  { type: 'cci', name: 'CCI', group: 'Oscillators', pane: true, levels: [100, -100], params: [P('n', 'Length', 20)], color: '#8d6e63', series: c => [L(c)], calc: (b, p) => [Ind.cci(b, p.n)] },
  { type: 'mfi', name: 'MFI', group: 'Oscillators', pane: true, levels: [80, 20], params: [P('n', 'Length', 14)], color: '#66bb6a', series: c => [L(c)], calc: (b, p) => [Ind.mfi(b, p.n)] },
  { type: 'adx', name: 'ADX / DMI', group: 'Oscillators', pane: true, levels: [25], params: [P('n', 'Length', 14)], color: '#ff9800', series: c => [L(c, { lineWidth: 2 }), L('#26a69a'), L('#ef5350')],
    calc: (b, p) => { const x = Ind.adx(b, p.n); return [x.adx, x.pdi, x.ndi]; } },
  { type: 'atr', name: 'ATR', group: 'Oscillators', pane: true, params: [P('n', 'Length', 14)], color: '#ef9a9a', series: c => [L(c)], calc: (b, p) => [Ind.atr(b, p.n)] },
  { type: 'obv', name: 'OBV', group: 'Oscillators', pane: true, single: true, color: '#4fc3f7', series: c => [L(c)], calc: b => [Ind.obv(b)] },
  { type: 'vp', name: 'Volume Profile', group: 'PRO', single: true, canvas: true },
  { type: 'fvg', name: 'Fair Value Gap', group: 'PRO', single: true, canvas: true },
];
const IND = Object.fromEntries(INDICATORS.map(d => [d.type, d]));

const uid = () => Math.random().toString(36).slice(2, 8);
const defaultParams = d => Object.fromEntries((d.params || []).map(x => [x.k, x.def]));
const newInd = (type, params) => ({ id: uid(), type, params: { ...defaultParams(IND[type]), ...params } });
const indLabel = i => { const d = IND[i.type]; return d.name + (d.params ? ` (${d.params.map(x => i.params[x.k]).join(', ')})` : ''); };
const indColor = i => i.color || IND[i.type].color;

// settings saved by older versions stored keys like 'ema50'/'rsi'; turn them into instances
function normInd(list) {
  return (list || []).map(x => {
    if (typeof x !== 'string') return IND[x.type] ? { ...x, params: { ...defaultParams(IND[x.type]), ...x.params } } : null;
    const m = /^(ema|sma)(\d+)$/.exec(x);
    return m ? newInd(m[1], { n: +m[2] }) : IND[x] ? newInd(x) : null;
  }).filter(Boolean);
}
