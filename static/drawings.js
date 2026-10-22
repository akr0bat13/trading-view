// Chart drawings. Points are stored as {t: unix time, p: price}, so a drawing survives timeframe
// changes and shows on every pane with the same market + symbol. Saved via State ('drawings').
// Cursor mode: click a drawing to select it, drag it or its points, Delete removes, Ctrl/Cmd+Z undoes.
const Draw = (() => {
  const POINTS = { hline: 1, hray: 1, vline: 1, cross: 1, text: 1, channel: 3, triangle: 3 }; // default 2
  const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const COLOR = { hline: '#f0b90b', hray: '#f0b90b', vline: '#9598a1', cross: '#9598a1', rect: '#7e57c2', fib: '#089981', text: '#d1d4dc', channel: '#2962ff', arrow: '#f23645', triangle: '#ff9800', ellipse: '#00bcd4', range: '#e040fb' };
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

  // the screen segments a drawing is made of: [[x1, y1, x2, y2], ...]
  function segments(d, [a, b = a, c = b], w, h) {
    const extend = (x1, y1, x2, y2, both) => {
      if (x1 === x2) return [x1, both ? 0 : y1, x2, y2 > y1 || both ? h : 0];
      const k = (y2 - y1) / (x2 - x1), xe = x2 >= x1 ? w : 0, xs = both ? (x2 >= x1 ? 0 : w) : x1;
      return [xs, y1 + k * (xs - x1), xe, y1 + k * (xe - x1)];
    };
    switch (d.type) {
      case 'trend': return [[a.x, a.y, b.x, b.y]];
      case 'ray': return [extend(a.x, a.y, b.x, b.y, false)];
      case 'ext': return [extend(a.x, a.y, b.x, b.y, true)];
      case 'hline': return [[0, a.y, w, a.y]];
      case 'hray': return [[a.x, a.y, w, a.y]];
      case 'vline': return [[a.x, 0, a.x, h]];
      case 'cross': return [[0, a.y, w, a.y], [a.x, 0, a.x, h]];
      case 'rect': return [[a.x, a.y, b.x, a.y], [b.x, a.y, b.x, b.y], [b.x, b.y, a.x, b.y], [a.x, b.y, a.x, a.y]];
      case 'arrow': { // head is 10px long, 25 degrees off the shaft
        const t = Math.atan2(a.y - b.y, a.x - b.x), head = k => [b.x, b.y, b.x + 10 * Math.cos(t + k), b.y + 10 * Math.sin(t + k)];
        return [[a.x, a.y, b.x, b.y], head(0.45), head(-0.45)];
      }
      case 'triangle': return [[a.x, a.y, b.x, b.y], [b.x, b.y, c.x, c.y], [c.x, c.y, a.x, a.y]];
      case 'ellipse': {
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, rx = (b.x - a.x) / 2, ry = (b.y - a.y) / 2, pt = i => [cx + rx * Math.cos(i * Math.PI / 24), cy + ry * Math.sin(i * Math.PI / 24)];
        return Array.from({ length: 48 }, (_, i) => [...pt(i), ...pt(i + 1)]);
      }
      case 'range': { const m = (a.x + b.x) / 2; return [[a.x, a.y, b.x, a.y], [a.x, b.y, b.x, b.y], [m, a.y, m, b.y]]; }
      case 'channel': { const o = channelOffset(a, b, c); return [[a.x, a.y, b.x, b.y], [a.x, a.y + o, b.x, b.y + o]]; }
      case 'fib': {
        const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
        return FIB.map(l => { const y = b.y + (a.y - b.y) * l; return [x1, y, x2, y]; });
      }
      default: return [];
    }
  }
  const channelOffset = (a, b, c) => c.y - (b.x === a.x ? a.y : a.y + (b.y - a.y) * (c.x - a.x) / (b.x - a.x));

  function screenPts(pane, d, G = geometry(pane)) { return d.pts.map(q => ({ x: G.x(q.t), y: G.y(q.p), p: q.p })); }

  function render(g, pane, w, h) {
    if (!pane.bars.length || S.hideDrawings) return;
    const items = list(pane.drawKey()), pend = pane.pending;
    if (!items.length && !pend) return;
    const G = geometry(pane);
    for (const d of pend ? [...items, pend] : items) {
      const P = screenPts(pane, d, G);
      if (P.some(q => q.y == null)) continue;
      const [a, b = a] = P, c = colorOf(d);
      g.strokeStyle = g.fillStyle = c; g.lineWidth = d.width || 1.5; g.setLineDash(DASH[d.dash || 'solid']);
      g.font = '11px -apple-system, sans-serif';
      if (d.type === 'rect') { g.globalAlpha = 0.15; g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); g.globalAlpha = 1; }
      if (['ellipse', 'triangle', 'range'].includes(d.type) && P.length >= (d.type === 'triangle' ? 3 : 2)) {
        g.globalAlpha = 0.12; g.beginPath();
        segments(d, P, w, h).forEach(([x1, y1], i) => i ? g.lineTo(x1, y1) : g.moveTo(x1, y1));
        if (d.type === 'range') { g.beginPath(); g.rect(a.x, a.y, b.x - a.x, b.y - a.y); }
        g.fill(); g.globalAlpha = 1;
      }
      if (d.type === 'range' && b !== a) {
        const dp = b.p - a.p; g.textBaseline = 'middle';
        g.fillText(`${dp >= 0 ? '+' : '-'}${fmtPrice(Math.abs(dp))} (${(dp / a.p * 100).toFixed(2)}%)`, (a.x + b.x) / 2 + 6, (a.y + b.y) / 2); g.textBaseline = 'alphabetic';
      }
      if (d.type === 'channel' && P.length === 3) {
        const o = channelOffset(...P);
        g.globalAlpha = 0.1; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(b.x, b.y + o); g.lineTo(a.x, a.y + o); g.fill(); g.globalAlpha = 1;
      }
      const segs = segments(d, P, w, h);
      segs.forEach(([x1, y1, x2, y2], i) => {
        if (d.type === 'fib') g.globalAlpha = FIB[i] === 0.5 || FIB[i] === 0.618 ? 1 : 0.6;
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      });
      g.globalAlpha = 1; g.setLineDash([]);
      if (d.type === 'fib') FIB.forEach((l, i) => g.fillText(`${l} (${fmtPrice(b.p + (a.p - b.p) * l)})`, segs[i][0] + 3, segs[i][1] - 3));
      if (['hline', 'hray', 'cross'].includes(d.type)) g.fillText((d.alert ? '🔔 ' : '') + fmtPrice(a.p), Math.max(a.x, 0) + 4, a.y - 4);
      if (d.type === 'text') {
        g.font = `${d.size || 14}px -apple-system, sans-serif`; g.textBaseline = 'middle';
        g.fillText(d.text || '', a.x, a.y);
        textW.set(d, g.measureText(d.text || '').width); g.textBaseline = 'alphabetic';
      }
      if (d === pend || d === Draw.sel?.d) P.forEach(q => {
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
      if (hi >= 0 && POINTS[d.type] !== 1) return { d, handle: hi };
      if (d.type === 'text') {
        const tw = textW.get(d) || 40, th = (d.size || 14) / 2 + 3;
        if (x >= P[0].x - 3 && x <= P[0].x + tw + 3 && Math.abs(y - P[0].y) <= th) return { d, handle: -1 };
        continue;
      }
      const [a, b = a] = P;
      if (['rect', 'fib', 'range'].includes(d.type) && x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x) && y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y))
        return { d, handle: -1 };
      const toSeg = ([x1, y1, x2, y2]) => {
        const L = (x2 - x1) ** 2 + (y2 - y1) ** 2, u = L ? Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / L)) : 0;
        return Math.hypot(x - x1 - u * (x2 - x1), y - y1 - u * (y2 - y1));
      };
      if (segments(d, P, w, h).some(s => toSeg(s) <= 6)) return { d, handle: -1 };
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
      if (Draw.tool === 'text') { e.preventDefault(); const d = { type: 'text', pts: [q], text: '' }; setTool(''); return editText(pane, d); }
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
      if (q.p != null) { pane.pending.pts[pane.pending.pts.length - 1] = q; pane.scheduleDraw(); }
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
      if (h?.d.type === 'text') { e.stopPropagation(); editText(pane, h.d); }
    }, true);
  }

  return Draw;
})();
