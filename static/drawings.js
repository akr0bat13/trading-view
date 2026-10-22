// Chart drawings. Points are stored as {t: unix time, p: price}, so a drawing survives timeframe
// changes and shows on every pane with the same market + symbol. Saved via State ('drawings').
// Cursor mode: click a drawing to select it, drag it or its points, Delete removes, Ctrl/Cmd+Z undoes.
const Draw = (() => {
  const POINTS = { hline: 1, hray: 1, vline: 1, cross: 1, text: 1, note: 1, channel: 3, triangle: 3, flat: 3, pitchfork: 3, fibext: 3, long: 3, short: 3, avwap: 1,
    arrowup: 1, arrowdown: 1, marker: 1, flag: 1, pricelabel: 1, xabcd: 5, cypher: 5, abcd: 4, hs: 7, drives: 7, elliott: 6, elliottc: 4 }; // default 2
  const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const COLOR = { hline: '#f0b90b', hray: '#f0b90b', vline: '#9598a1', cross: '#9598a1', rect: '#7e57c2', fib: '#089981', text: '#d1d4dc', channel: '#2962ff', arrow: '#f23645', triangle: '#ff9800', ellipse: '#00bcd4', range: '#e040fb', daterange: '#e040fb', dprange: '#e040fb', circle: '#00bcd4',
    arrowup: '#089981', arrowdown: '#f23645', marker: '#f0b90b', flag: '#f0b90b', pricelabel: '#2962ff', avwap: '#f0b90b', long: '#089981', short: '#f23645',
    highlighter: '#f0b90b', brush: '#e040fb', note: '#f0b90b', pitchfork: '#2962ff' };
  const PALETTE = ['#2962ff', '#089981', '#f23645', '#f0b90b', '#ff9800', '#e040fb', '#00bcd4', '#d1d4dc', '#787b86', '#ffffff'];
  const colorOf = d => d.color || COLOR[d.type] || '#2962ff';
  const DASH = { solid: [], dash: [6, 4], dot: [1.5, 3] };
  let all = {}; // "crypto:BTC" -> [drawing]
  let undo = [], redo = [];
  const textW = new WeakMap(); // drawn text width, for hit testing

  const load = doc => { all = doc && typeof doc === 'object' ? doc : {}; State.data.drawings = all; };
  const list = key => all[key] || [];
  const mut = key => all[key] ||= []; // create the list only when writing
  const changed = () => { State.save('drawings'); panes.forEach(p => p.scheduleDraw()); };
  const snapshot = () => { undo.push(JSON.stringify(all)); if (undo.length > 100) undo.shift(); redo = []; };
  function restore(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(all));
    const o = JSON.parse(from.pop());
    Object.keys(all).forEach(k => delete all[k]);
    Object.assign(all, o);
    Draw.sel = null; UI.syncDrawToolbar(); changed();
  }

  // time <-> x via fractional bar index, so points between/after bars (or from another timeframe) still map
  function geometry(pane) {
    const ts = pane.chart.timeScale(), b = pane.bars, n = b.length;
    const x0 = ts.logicalToCoordinate(0), dx = ts.logicalToCoordinate(1) - x0;
    const step = i => n > 1 ? b[Math.min(Math.max(i, 1), n - 1)].time - b[Math.min(Math.max(i, 1), n - 1) - 1].time : 60;
    function tToL(t) {
      if (t <= b[0].time) return (t - b[0].time) / step(1);
      if (t >= b[n - 1].time) return n - 1 + (t - b[n - 1].time) / step(n - 1);
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b[m].time <= t) lo = m; else hi = m; }
      return lo + (t - b[lo].time) / (b[hi].time - b[lo].time);
    }
    function lToT(l) {
      if (l <= 0) return b[0].time + l * step(1);
      if (l >= n - 1) return b[n - 1].time + (l - n + 1) * step(n - 1);
      const i = Math.floor(l);
      return b[i].time + (l - i) * (b[i + 1].time - b[i].time);
    }
    return {
      x: t => x0 + tToL(t) * dx, y: p => pane.candles.priceToCoordinate(p),
      t: x => lToT((x - x0) / dx), p: y => pane.candles.coordinateToPrice(y),
      l: x => (x - x0) / dx, lx: l => x0 + l * dx,
    };
  }

  // the screen segments a drawing is made of: [[x1, y1, x2, y2], ...]. pane/G are only needed by avwap.
  const FIBEXT = [0, 0.618, 1, 1.618, 2.618], FIBSEQ = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55];
  const PATTERN = { xabcd: ['X', 'A', 'B', 'C', 'D'], cypher: ['X', 'A', 'B', 'C', 'D'], abcd: ['A', 'B', 'C', 'D'], hs: ['', 'LS', '', 'H', '', 'RS', ''],
    drives: ['', '1', '', '2', '', '3', ''], elliott: ['0', '1', '2', '3', '4', '5'], elliottc: ['0', 'A', 'B', 'C'] };
  const FREE = ['brush', 'highlighter'], TEXTY = ['text', 'note'];
  function segments(d, P, w, h, pane, G) {
    const [a, b = a, c = b] = P;
    const extend = (x1, y1, x2, y2, both) => {
      if (x1 === x2) return [x1, both ? 0 : y1, x2, y2 > y1 || both ? h : 0];
      const k = (y2 - y1) / (x2 - x1), xe = x2 >= x1 ? w : 0, xs = both ? (x2 >= x1 ? 0 : w) : x1;
      return [xs, y1 + k * (xs - x1), xe, y1 + k * (xe - x1)];
    };
    const ray = (x1, y1, x2, y2) => extend(x1, y1, x2, y2, false);
    const line = (p, q) => [p.x, p.y, q.x, q.y];
    const chain = pts => pts.slice(1).map((q, i) => line(pts[i], q));
    const poly = pts => chain([...pts, pts[0]]);
    const rect = (x1, y1, x2, y2) => poly([{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }]);
    const circ = (cx, cy, rx, ry) => { const pt = i => ({ x: cx + rx * Math.cos(i * Math.PI / 24), y: cy + ry * Math.sin(i * Math.PI / 24) }); return chain(Array.from({ length: 49 }, (_, i) => pt(i))); };
    const head = (p, q) => { const t = Math.atan2(p.y - q.y, p.x - q.x), e = k => [q.x, q.y, q.x + 10 * Math.cos(t + k), q.y + 10 * Math.sin(t + k)]; return [e(0.45), e(-0.45)]; };
    const big = s => poly([[0, 0], [-8, 9], [-3, 9], [-3, 22], [3, 22], [3, 9], [8, 9]].map(([x, y]) => ({ x: a.x + x, y: a.y + s * y })));
    switch (d.type) {
      case 'trend': case 'info': return [line(a, b)];
      case 'angle': return [line(a, b), [a.x, a.y, b.x, a.y]];
      case 'ray': return [extend(a.x, a.y, b.x, b.y, false)];
      case 'ext': return [extend(a.x, a.y, b.x, b.y, true)];
      case 'hline': return [[0, a.y, w, a.y]];
      case 'hray': return [[a.x, a.y, w, a.y]];
      case 'vline': return [[a.x, 0, a.x, h]];
      case 'cross': return [[0, a.y, w, a.y], [a.x, 0, a.x, h]];
      case 'rect': return rect(a.x, a.y, b.x, b.y);
      case 'channel': { const o = channelOffset(a, b, c); return [[a.x, a.y, b.x, b.y], [a.x, a.y + o, b.x, b.y + o]]; }
      case 'flat': return [line(a, b), [a.x, c.y, b.x, c.y]];
      case 'pitchfork': { // median line through the middle of b-c, parallels through b and c
        const m = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 }, dx = m.x - a.x, dy = m.y - a.y;
        return [ray(a.x, a.y, m.x, m.y), ray(b.x, b.y, b.x + dx, b.y + dy), ray(c.x, c.y, c.x + dx, c.y + dy), line(b, c)];
      }
      case 'fib': {
        const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
        return FIB.map(l => { const y = b.y + (a.y - b.y) * l; return [x1, y, x2, y]; });
      }
      case 'fibext': {
        const x1 = c.x, x2 = c.x + Math.max(80, Math.abs(c.x - a.x));
        return [line(a, b), line(b, c), ...FIBEXT.map(l => { const y = c.y + (b.y - a.y) * l; return [x1, y, x2, y]; })];
      }
      case 'fibtz': return FIBSEQ.map(n => { const x = a.x + (b.x - a.x) * n; return [x, 0, x, h]; });
      case 'fibfan': return [line(a, b), ...[0.25, 0.382, 0.5, 0.618, 0.75].map(l => ray(a.x, a.y, b.x, a.y + (b.y - a.y) * l))];
      case 'gannfan': return [1 / 4, 1 / 3, 1 / 2, 1, 2, 3, 4].map(r => ray(a.x, a.y, b.x, a.y + (b.y - a.y) * r));
      case 'gannbox': return [...rect(a.x, a.y, b.x, b.y), [a.x, a.y, b.x, b.y], [a.x, b.y, b.x, a.y],
        ...[0.25, 0.5, 0.75].flatMap(f => [[a.x + (b.x - a.x) * f, a.y, a.x + (b.x - a.x) * f, b.y], [a.x, a.y + (b.y - a.y) * f, b.x, a.y + (b.y - a.y) * f]])];
      case 'xabcd': case 'cypher': return [...chain(P), line(P[0], P[2]), line(P[2], P[4]), line(P[1], P[3])];
      case 'abcd': return [...chain(P), line(P[0], P[2]), line(P[1], P[3])];
      case 'hs': return [...chain(P), line(P[2], P[4])];
      case 'drives': case 'elliott': case 'elliottc': case 'brush': case 'highlighter': return chain(P);
      case 'triangle': return poly([a, b, c]);
      case 'ellipse': return circ((a.x + b.x) / 2, (a.y + b.y) / 2, (b.x - a.x) / 2, (b.y - a.y) / 2);
      case 'circle': { const r = Math.hypot(b.x - a.x, b.y - a.y); return circ(a.x, a.y, r, r); }
      case 'cycles': {
        const s = b.x - a.x, out = [];
        if (Math.abs(s) < 4) return out;
        for (let k = Math.ceil(Math.min(-a.x / s, (w - a.x) / s)); k <= Math.max(-a.x / s, (w - a.x) / s) && out.length < 200; k++) out.push([a.x + k * s, 0, a.x + k * s, h]);
        return out;
      }
      case 'long': case 'short': return [...rect(a.x, a.y, b.x, b.y), ...rect(a.x, a.y, b.x, c.y)];
      case 'forecast': return [line(a, b), ...head(a, b)].map(s => s);
      case 'arrow': return [line(a, b), ...head(a, b)];
      case 'arrowup': return big(1);
      case 'arrowdown': return big(-1);
      case 'marker': return circ(a.x, a.y - 8, 6, 6);
      case 'flag': return [[a.x, a.y, a.x, a.y - 26], ...poly([{ x: a.x, y: a.y - 26 }, { x: a.x + 18, y: a.y - 20 }, { x: a.x, y: a.y - 14 }])];
      case 'pricelabel': return rect(a.x, a.y - 9, a.x + 64, a.y + 9);
      case 'range': return [[a.x, a.y, b.x, a.y], [a.x, b.y, b.x, b.y], [(a.x + b.x) / 2, a.y, (a.x + b.x) / 2, b.y]];
      case 'daterange': return [[a.x, a.y, b.x, a.y], [a.x, a.y - 8, a.x, a.y + 8], [b.x, a.y - 8, b.x, a.y + 8], ...head({ x: a.x, y: a.y }, { x: b.x, y: a.y })];
      case 'dprange': return [...rect(a.x, a.y, b.x, b.y), [(a.x + b.x) / 2, a.y, (a.x + b.x) / 2, b.y], [a.x, (a.y + b.y) / 2, b.x, (a.y + b.y) / 2]];
      case 'avwap': { // anchored VWAP from the anchor bar to the last bar
        if (!pane) return [];
        const out = []; let pv = 0, v = 0;
        for (const bar of pane.bars) {
          if (bar.time < d.pts[0].t) continue;
          pv += (bar.high + bar.low + bar.close) / 3 * bar.volume; v += bar.volume;
          if (v) out.push({ x: G.x(bar.time), y: G.y(pv / v) });
        }
        return out.length > 1 && out.every(q => q.y != null) ? chain(out) : [];
      }
      default: return [];
    }
  }
  const channelOffset = (a, b, c) => c.y - (b.x === a.x ? a.y : a.y + (b.y - a.y) * (c.x - a.x) / (b.x - a.x));

  function screenPts(pane, d, G = geometry(pane)) { return d.pts.map(q => ({ x: G.x(q.t), y: G.y(q.p), p: q.p })); }

  // translucent areas: [{pts: [[x, y], ...], color?}]
  function fills(d, P, segs) {
    const [a, b = a, c = b] = P, tri = s => s.map(q => [q[0], q[1]]), box = (x1, y1, x2, y2) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
    switch (d.type) {
      case 'ellipse': case 'circle': case 'triangle': case 'arrowup': case 'arrowdown': case 'marker': return [{ pts: tri(segs) }];
      case 'flag': return [{ pts: tri(segs.slice(1)) }];
      case 'range': case 'dprange': return [{ pts: box(a.x, a.y, b.x, b.y) }];
      case 'flat': return [{ pts: [[a.x, a.y], [b.x, b.y], [b.x, c.y], [a.x, c.y]] }];
      case 'channel': return [{ pts: [[a.x, a.y], [b.x, b.y], [b.x, b.y + channelOffset(a, b, c)], [a.x, a.y + channelOffset(a, b, c)]] }];
      case 'long': case 'short': return [{ pts: box(a.x, a.y, b.x, b.y), color: '#089981' }, { pts: box(a.x, a.y, b.x, c.y), color: '#f23645' }];
      case 'xabcd': case 'cypher': return [{ pts: [[P[0].x, P[0].y], [P[1].x, P[1].y], [P[2].x, P[2].y]] }, { pts: [[P[2].x, P[2].y], [P[3].x, P[3].y], [P[4].x, P[4].y]] }];
      default: return [];
    }
  }

  // text labels: [[text, x, y]]
  function labels(d, P, G) {
    const [a, b = a, c = b] = P, bars = Math.round(Math.abs(G.l(b.x) - G.l(a.x))), dp = b.p - a.p, sgn = dp >= 0 ? '+' : '-';
    const pct = (x, y) => `${(x / y * 100).toFixed(2)}%`;
    if (PATTERN[d.type]) {
      const names = PATTERN[d.type];
      return P.map((q, i) => { const up = (P[i - 1] ? q.y <= P[i - 1].y : true) && (P[i + 1] ? q.y <= P[i + 1].y : true); return [names[i] ?? '', q.x - 3, q.y + (up ? -7 : 14)]; });
    }
    switch (d.type) {
      case 'info': return [[`${sgn}${fmtPrice(Math.abs(dp))} (${pct(dp, a.p)}) · ${bars} bars`, b.x + 6, b.y]];
      case 'angle': return [[`${(Math.atan2(a.y - b.y, b.x - a.x) * 180 / Math.PI).toFixed(1)}°`, a.x + 20, a.y - 6]];
      case 'range': return [[`${sgn}${fmtPrice(Math.abs(dp))} (${pct(dp, a.p)})`, (a.x + b.x) / 2 + 6, (a.y + b.y) / 2]];
      case 'daterange': return [[`${bars} bars`, (a.x + b.x) / 2, a.y - 8]];
      case 'dprange': return [[`${sgn}${fmtPrice(Math.abs(dp))} (${pct(dp, a.p)}) · ${bars} bars`, Math.min(a.x, b.x) + 6, Math.min(a.y, b.y) + 14]];
      case 'fibext': return FIBEXT.map(l => [`${l} (${fmtPrice(c.p + (b.p - a.p) * l)})`, c.x + 3, c.y + (b.y - a.y) * l - 3]);
      case 'fibtz': return FIBSEQ.map(n => [String(n), a.x + (b.x - a.x) * n + 3, 12]);
      case 'long': case 'short': {
        const rr = Math.abs(b.p - a.p) / (Math.abs(c.p - a.p) || 1);
        return [[`${pct(b.p - a.p, a.p)} target · ${pct(c.p - a.p, a.p)} stop · R/R ${rr.toFixed(2)}`, Math.min(a.x, b.x) + 4, Math.min(a.y, b.y, c.y) - 6]];
      }
      case 'pricelabel': return [[fmtPrice(a.p), a.x + 6, a.y + 4]];
      case 'avwap': return [['AVWAP', a.x + 4, a.y - 6]];
      default: return [];
    }
  }

  function render(g, pane, w, h) {
    if (!pane.bars.length || S.hideDrawings) return;
    const items = list(pane.drawKey()), pend = pane.pending;
    if (!items.length && !pend) return;
    const G = geometry(pane);
    for (const d of pend ? [...items, pend] : items) {
      const P = screenPts(pane, d, G);
      if (!P.length || P.some(q => q.y == null)) continue;
      while (P.length < (POINTS[d.type] || 2) && !FREE.includes(d.type)) P.push(P[P.length - 1]); // pending multi-point drawing
      const [a, b = a] = P, c = colorOf(d);
      g.strokeStyle = g.fillStyle = c; g.lineWidth = d.width || 1.5; g.setLineDash(DASH[d.dash || 'solid']); g.lineCap = g.lineJoin = 'round';
      g.font = '11px -apple-system, sans-serif';
      const segs = segments(d, P, w, h, pane, G);
      for (const f of fills(d, P, segs)) {
        g.fillStyle = f.color || c; g.globalAlpha = 0.12; g.beginPath();
        f.pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill();
      }
      g.globalAlpha = d.type === 'highlighter' ? 0.35 : 1; g.fillStyle = c;
      if (d.type === 'highlighter') g.lineWidth = d.width || 14;
      segs.forEach(([x1, y1, x2, y2], i) => {
        if (d.type === 'fib') g.globalAlpha = FIB[i] === 0.5 || FIB[i] === 0.618 ? 1 : 0.6;
        if (['xabcd', 'cypher', 'abcd', 'hs'].includes(d.type) && i >= P.length - 1) g.setLineDash([4, 3]);
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      });
      g.globalAlpha = 1; g.setLineDash([]);
      if (d.type === 'fib') FIB.forEach((l, i) => g.fillText(`${l} (${fmtPrice(b.p + (a.p - b.p) * l)})`, segs[i][0] + 3, segs[i][1] - 3));
      for (const [t, x, y] of labels(d, P, G)) g.fillText(t, x, y);
      if (['hline', 'hray', 'cross'].includes(d.type)) g.fillText((d.alert ? '🔔 ' : '') + fmtPrice(a.p), Math.max(a.x, 0) + 4, a.y - 4);
      if (TEXTY.includes(d.type)) {
        g.font = `${d.size || 14}px -apple-system, sans-serif`; g.textBaseline = 'middle';
        const tw = g.measureText(d.text || '').width;
        if (d.type === 'note') { g.globalAlpha = 0.2; g.fillRect(a.x - 5, a.y - 11, tw + 10, 22); g.globalAlpha = 1; g.strokeRect(a.x - 5, a.y - 11, tw + 10, 22); }
        g.fillText(d.text || '', a.x, a.y);
        textW.set(d, tw); g.textBaseline = 'alphabetic';
      }
      if (!FREE.includes(d.type) && (d === pend || d === Draw.sel?.d)) P.forEach(q => {
        g.beginPath(); g.arc(q.x, q.y, 4.5, 0, 7); g.fillStyle = '#131722'; g.fill(); g.strokeStyle = '#2962ff'; g.lineWidth = 1.5; g.stroke();
      });
    }
  }

  // what's under (x, y): {d, handle: point index or -1} or null. Selected drawing wins ties.
  function hit(pane, x, y) {
    if (S.hideDrawings || S.lockDrawings || !pane.bars.length) return null;
    const cv = pane.canvas, w = cv.clientWidth, h = cv.clientHeight, G = geometry(pane);
    const items = list(pane.drawKey()), order = Draw.sel ? [Draw.sel.d, ...items.filter(d => d !== Draw.sel.d)] : [...items].reverse();
    for (const d of order) {
      if (!items.includes(d)) continue;
      const P = screenPts(pane, d, G);
      if (P.some(q => q.y == null)) continue;
      const hi = P.findIndex(q => Math.hypot(q.x - x, q.y - y) <= 7);
      if (hi >= 0 && POINTS[d.type] !== 1 && !FREE.includes(d.type)) return { d, handle: hi };
      if (TEXTY.includes(d.type)) {
        const tw = textW.get(d) || 40, th = (d.size || 14) / 2 + 3;
        if (x >= P[0].x - 3 && x <= P[0].x + tw + 3 && Math.abs(y - P[0].y) <= th) return { d, handle: -1 };
        continue;
      }
      const [a, b = a] = P;
      if (['rect', 'fib', 'range', 'dprange', 'gannbox'].includes(d.type) && x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x) && y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y))
        return { d, handle: -1 };
      const toSeg = ([x1, y1, x2, y2]) => {
        const L = (x2 - x1) ** 2 + (y2 - y1) ** 2, u = L ? Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / L)) : 0;
        return Math.hypot(x - x1 - u * (x2 - x1), y - y1 - u * (y2 - y1));
      };
      if (segments(d, P, w, h, pane, G).some(s => toSeg(s) <= 6)) return { d, handle: -1 };
    }
    return null;
  }

  // magnet: snap to the nearest bar's O/H/L/C when close enough
  function snap(pane, x, y, G) {
    if (!S.magnet) return null;
    const i = Math.round(G.l(x)), bar = pane.bars[i];
    if (!bar) return null;
    const best = [bar.open, bar.high, bar.low, bar.close].map(p => [p, Math.abs(G.y(p) - y)]).sort((u, v) => u[1] - v[1])[0];
    return best[1] < 40 ? { t: bar.time, p: best[0] } : null;
  }

  function point(pane, e, magnet = true) {
    const r = pane.canvas.getBoundingClientRect(), G = geometry(pane), x = e.clientX - r.left, y = e.clientY - r.top;
    return { x, y, q: (magnet && snap(pane, x, y, G)) || { t: Math.round(G.t(x)), p: G.p(y) } };
  }

  // ---- public API ----
  const Draw = { tool: '', sel: null, load, changed, list, setTool, clear, remove, update, attach, render, editText, colorOf, deselect: () => Draw.sel && select(null), undo: () => restore(undo, redo), redo: () => restore(redo, undo), PALETTE };

  function setTool(tool) {
    Draw.tool = tool;
    panes.forEach(p => { p.pending = null; p.canvas.parentElement.classList.toggle('drawing', !!tool); p.scheduleDraw(); });
    if (tool) select(null);
    UI.syncTools();
  }
  function select(sel) { Draw.sel = sel; UI.syncDrawToolbar(); panes.forEach(p => p.scheduleDraw()); }
  function clear(pane) {
    const key = pane.drawKey();
    if (list(key).length && confirm(`Delete all drawings on ${pane.cfg.symbol}?`)) { snapshot(); all[key] = []; select(null); changed(); }
  }
  function remove() {
    if (!Draw.sel) return;
    const items = list(Draw.sel.key), i = items.indexOf(Draw.sel.d);
    if (i >= 0) { snapshot(); items.splice(i, 1); }
    select(null); changed();
  }
  function update(props) { // style change of the selected drawing
    if (!Draw.sel) return;
    snapshot(); Object.assign(Draw.sel.d, props); UI.syncDrawToolbar(); changed();
  }

  function editText(pane, d) {
    const [a] = screenPts(pane, d), inp = document.createElement('input');
    inp.className = 'text-edit'; inp.value = d.text || '';
    inp.style.left = a.x + 'px'; inp.style.top = (a.y - 14) + 'px';
    pane.canvas.parentElement.append(inp);
    setTimeout(() => inp.focus());
    const key = pane.drawKey();
    let done = false;
    const finish = save => {
      if (done) return; done = true;
      inp.remove();
      const items = mut(key), had = items.includes(d), text = inp.value.trim();
      if (save && text) { snapshot(); d.text = text; if (!had) items.push(d); }
      else if (save && had) { snapshot(); items.splice(items.indexOf(d), 1); }
      changed();
    };
    inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
    inp.onblur = () => finish(true);
  }

  function attach(pane) {
    const cv = pane.canvas, wrap = cv.parentElement;
    let drag = null;

    // creating: canvas only receives pointer events while a tool is active
    cv.addEventListener('pointerdown', e => {
      if (!Draw.tool || !pane.bars.length) return;
      const { q } = point(pane, e), key = pane.drawKey(), items = mut(key), need = POINTS[Draw.tool] || 2;
      if (q.p == null) return;
      if (FREE.includes(Draw.tool)) { e.preventDefault(); pane.pending = { type: Draw.tool, pts: [q], free: true }; return cv.setPointerCapture(e.pointerId); }
      if (TEXTY.includes(Draw.tool)) { e.preventDefault(); const d = { type: Draw.tool, pts: [q], text: '' }; setTool(''); return editText(pane, d); }
      if (need === 1) { snapshot(); const d = { type: Draw.tool, pts: [q] }; items.push(d); setTool(''); select({ key, d }); return changed(); }
      if (!pane.pending) { pane.pending = { type: Draw.tool, pts: [q, q] }; return; }
      const p = pane.pending;
      p.pts[p.pts.length - 1] = q;
      if (p.pts.length < need) { p.pts.push(q); return; }
      snapshot(); items.push(p);
      pane.pending = null;
      setTool('');
      select({ key, d: p });
      changed();
    });
    cv.addEventListener('pointermove', e => {
      if (!pane.pending) return;
      const { q } = point(pane, e);
      if (pane.pending.free) { if (q.p != null && e.buttons) { pane.pending.pts.push(q); pane.scheduleDraw(); } return; }
      if (q.p != null) { pane.pending.pts[pane.pending.pts.length - 1] = q; pane.scheduleDraw(); }
    });

    cv.addEventListener('pointerup', () => {
      const p = pane.pending;
      if (!p?.free) return;
      pane.pending = null; setTool('');
      if (p.pts.length < 2) return pane.scheduleDraw();
      delete p.free; snapshot(); mut(pane.drawKey()).push(p); select({ key: pane.drawKey(), d: p }); changed();
    });

    // editing: in cursor mode, intercept presses on drawings before the chart sees them
    wrap.addEventListener('pointerdown', e => {
      if (Draw.tool || e.button !== 0 || e.target.closest('.legend, .text-edit, .dtb')) return;
      const { x, y, q } = point(pane, e, false), h = hit(pane, x, y);
      if (!h) { if (Draw.sel) select(null); return; }
      e.preventDefault(); e.stopPropagation();
      select({ key: pane.drawKey(), d: h.d });
      drag = { h, start: q, orig: h.d.pts.map(p => ({ ...p })), moved: false, before: JSON.stringify(all) };
      wrap.setPointerCapture(e.pointerId);
    }, true);
    for (const t of ['mousedown', 'touchstart']) wrap.addEventListener(t, e => { if (drag) e.stopPropagation(); }, true);
    wrap.addEventListener('pointermove', e => {
      if (!drag) {
        if (Draw.tool || e.buttons) return;
        const { x, y } = point(pane, e, false), h = hit(pane, x, y);
        wrap.classList.toggle('over-handle', !!h && h.handle >= 0);
        wrap.classList.toggle('over-draw', !!h && h.handle < 0);
        return;
      }
      const { q } = point(pane, e, drag.h.handle >= 0), d = drag.h.d;
      if (q.p == null) return;
      drag.moved = true;
      if (drag.h.handle >= 0) d.pts[drag.h.handle] = q;
      else {
        const dt = q.t - drag.start.t, dp = q.p - drag.start.p;
        d.pts = drag.orig.map(o => ({ t: Math.round(o.t + dt), p: o.p + dp }));
      }
      panes.forEach(p => p.drawKey() === pane.drawKey() && p.scheduleDraw());
    });
    const end = () => {
      if (!drag) return;
      if (drag.moved) { undo.push(drag.before); redo = []; changed(); }
      drag = null;
    };
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', end);
    wrap.addEventListener('dblclick', e => {
      const { x, y } = point(pane, e, false), h = hit(pane, x, y);
      if (TEXTY.includes(h?.d.type)) { e.stopPropagation(); editText(pane, h.d); }
    }, true);
  }

  return Draw;
})();
