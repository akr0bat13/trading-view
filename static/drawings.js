// Chart drawings. Points are stored as {t: unix time, p: price}, so a drawing survives timeframe
// changes and shows on every pane with the same market + symbol. Saved via State ('drawings').
const Draw = (() => {
  const ONE_POINT = ['hline', 'hray', 'vline', 'cross'];
  const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const COLOR = { trend: '#2962ff', ray: '#2962ff', ext: '#2962ff', hline: '#f0b90b', hray: '#f0b90b', vline: '#9598a1', cross: '#9598a1', rect: '#7e57c2', fib: '#089981' };
  let all = {}; // "crypto:BTC" -> [drawing]

  const load = doc => { all = doc && typeof doc === 'object' ? doc : {}; State.data.drawings = all; };
  const list = key => all[key] || (all[key] = []);
  const changed = key => { State.save('drawings'); panes.forEach(p => p.drawKey() === key && p.scheduleDraw()); };

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
    };
  }

  // the screen segments a drawing is made of: [[x1, y1, x2, y2], ...]
  function segments(d, a, b, w, h) {
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
      default: return [];
    }
  }

  function render(g, pane, w, h) {
    const items = list(pane.drawKey()), pend = pane.pending;
    if (!pane.bars.length || (!items.length && !pend)) return;
    const G = geometry(pane);
    g.setLineDash([]); g.lineWidth = 1.5; g.font = '11px -apple-system, sans-serif';
    for (const d of pend ? [...items, pend] : items) {
      const c = d.color || COLOR[d.type], [a, b = a] = d.pts.map(q => ({ x: G.x(q.t), y: G.y(q.p), p: q.p }));
      if (a.y == null || b.y == null) continue;
      g.strokeStyle = g.fillStyle = c;
      if (d.type === 'rect') { g.globalAlpha = 0.15; g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); g.globalAlpha = 1; }
      for (const [x1, y1, x2, y2] of segments(d, a, b, w, h)) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
      if (d.type === 'hline' || d.type === 'hray' || d.type === 'cross') g.fillText(fmtPrice(a.p), Math.max(a.x, 0) + 4, a.y - 4);
      if (d.type === 'fib') {
        const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
        FIB.forEach(l => {
          const price = b.p + (a.p - b.p) * l, yy = G.y(price);
          if (yy == null) return;
          g.globalAlpha = l === 0.5 || l === 0.618 ? 1 : 0.6;
          g.beginPath(); g.moveTo(x1, yy); g.lineTo(x2, yy); g.stroke();
          g.fillText(`${l} (${fmtPrice(price)})`, x1 + 3, yy - 3);
        });
        g.globalAlpha = 1;
      }
      if (d === pend || Draw.tool === 'erase') [a, b].forEach(q => { g.beginPath(); g.arc(q.x, q.y, 3, 0, 7); g.fill(); });
    }
  }

  // distance in px from (x, y) to a drawing
  function distance(pane, d, x, y, w, h) {
    const G = geometry(pane), [a, b = a] = d.pts.map(q => ({ x: G.x(q.t), y: G.y(q.p), p: q.p }));
    if (d.type === 'fib' || d.type === 'rect') {
      const inside = x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x) && y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y);
      if (inside) return 0;
    }
    const toSeg = ([x1, y1, x2, y2]) => {
      const L = (x2 - x1) ** 2 + (y2 - y1) ** 2, u = L ? Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / L)) : 0;
      return Math.hypot(x - x1 - u * (x2 - x1), y - y1 - u * (y2 - y1));
    };
    return Math.min(Infinity, ...segments(d, a, b, w, h).map(toSeg));
  }

  // ---- tools ----
  const Draw = { tool: '', load, list, changed, geometry, distance, render, attach, setTool, clear };

  function setTool(tool) {
    Draw.tool = tool;
    panes.forEach(p => { p.pending = null; p.canvas.parentElement.classList.toggle('drawing', !!tool); p.scheduleDraw(); });
    UI.syncTools();
  }

  function clear(pane) {
    const key = pane.drawKey();
    if (list(key).length && confirm(`Delete all drawings on ${pane.cfg.symbol}?`)) { all[key] = []; changed(key); }
  }

  function attach(pane) {
    const cv = pane.canvas;
    const pt = e => {
      const r = cv.getBoundingClientRect(), G = geometry(pane), x = e.clientX - r.left, y = e.clientY - r.top;
      return { x, y, q: { t: Math.round(G.t(x)), p: G.p(y) } };
    };
    cv.addEventListener('pointerdown', e => {
      if (!Draw.tool || !pane.bars.length) return;
      const { x, y, q } = pt(e), key = pane.drawKey(), items = list(key);
      if (q.p == null) return;
      if (Draw.tool === 'erase') {
        let best = -1, bd = 6;
        items.forEach((d, i) => { const dd = distance(pane, d, x, y, cv.clientWidth, cv.clientHeight); if (dd <= bd) { bd = dd; best = i; } });
        if (best >= 0) { items.splice(best, 1); changed(key); }
        return;
      }
      if (ONE_POINT.includes(Draw.tool)) { items.push({ type: Draw.tool, pts: [q] }); changed(key); return setTool(''); }
      if (!pane.pending) { pane.pending = { type: Draw.tool, pts: [q, q] }; return; }
      pane.pending.pts[1] = q;
      items.push(pane.pending);
      pane.pending = null;
      changed(key);
      setTool('');
    });
    cv.addEventListener('pointermove', e => {
      if (!pane.pending) return;
      const { q } = pt(e);
      if (q.p != null) { pane.pending.pts[1] = q; pane.scheduleDraw(); }
    });
  }

  return Draw;
})();
