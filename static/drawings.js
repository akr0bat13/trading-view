// Chart drawings: trend line, ray, horizontal line, rectangle, Fibonacci retracement.
// Points are stored as {t: unix time, p: price}, so a drawing survives timeframe changes and
// shows on every pane with the same market + symbol. Saved to drawings.json via the Flask API.
const Draw = (() => {
  const TOOLS = [['trend', 'Trend line'], ['ray', 'Ray'], ['hline', 'Horizontal line'], ['rect', 'Rectangle'], ['fib', 'Fib retracement']];
  const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const COLOR = { trend: '#2962ff', ray: '#2962ff', hline: '#f0b90b', rect: '#7e57c2', fib: '#26a69a' };
  let all = {}; // "crypto:BTC" -> [drawing]

  const load = async () => { try { all = await (await fetch('/api/drawings')).json(); } catch { all = {}; } };
  const list = key => all[key] || (all[key] = []);
  const save = key => fetch('/api/drawings/' + encodeURIComponent(key), {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(list(key)),
  }).catch(() => { });

  // time <-> x via fractional bar index, so points between/after bars (or from another timeframe) still map
  function geometry(pane) {
    const ts = pane.chart.timeScale(), b = pane.bars, n = b.length;
    const x0 = ts.logicalToCoordinate(0), dx = ts.logicalToCoordinate(1) - x0;
    const step = (i) => n > 1 ? b[Math.min(Math.max(i, 1), n - 1)].time - b[Math.min(Math.max(i, 1), n - 1) - 1].time : 60;
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

  function render(g, pane, w, h) {
    const items = list(pane.drawKey()), pend = pane.pending;
    if (!pane.bars.length || (!items.length && !pend)) return;
    const G = geometry(pane);
    g.setLineDash([]); g.lineWidth = 1.5; g.font = '10px system-ui';
    for (const d of pend ? [...items, pend] : items) {
      const c = d.color || COLOR[d.type], [a, b = a] = d.pts.map(q => ({ x: G.x(q.t), y: G.y(q.p), p: q.p }));
      if (a.y == null || b.y == null) continue;
      g.strokeStyle = g.fillStyle = c;
      const seg = (x1, y1, x2, y2) => { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
      if (d.type === 'trend') seg(a.x, a.y, b.x, b.y);
      if (d.type === 'ray') {
        const k = b.x === a.x ? 0 : (b.y - a.y) / (b.x - a.x), xe = b.x >= a.x ? w : 0;
        seg(a.x, a.y, xe, b.x === a.x ? b.y : a.y + k * (xe - a.x));
      }
      if (d.type === 'hline') { seg(0, a.y, w, a.y); g.fillText(fmtPrice(a.p), 4, a.y - 3); }
      if (d.type === 'rect') {
        g.globalAlpha = 0.15; g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); g.globalAlpha = 1;
        g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      }
      if (d.type === 'fib') {
        const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
        FIB.forEach(l => {
          const price = b.p + (a.p - b.p) * l, yy = G.y(price);
          if (yy == null) return;
          g.globalAlpha = l === 0.5 || l === 0.618 ? 1 : 0.6;
          seg(x1, yy, x2, yy);
          g.fillText(`${l} (${fmtPrice(price)})`, x1 + 3, yy - 3);
        });
        g.globalAlpha = 1;
      }
      if (d === pend || pane.tool === 'erase') [a, b].forEach(q => { g.beginPath(); g.arc(q.x, q.y, 3, 0, 7); g.fill(); });
    }
  }

  // distance from (x, y) to a drawing in px, for the eraser
  function distance(pane, d, x, y) {
    const G = geometry(pane), [a, b = a] = d.pts.map(q => ({ x: G.x(q.t), y: G.y(q.p) }));
    const toSeg = (x1, y1, x2, y2) => {
      const L = (x2 - x1) ** 2 + (y2 - y1) ** 2, u = L ? Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / L)) : 0;
      return Math.hypot(x - x1 - u * (x2 - x1), y - y1 - u * (y2 - y1));
    };
    if (d.type === 'hline') return Math.abs(y - a.y);
    if (d.type === 'trend') return toSeg(a.x, a.y, b.x, b.y);
    if (d.type === 'ray') { const far = b.x >= a.x ? 1e5 : -1e5, k = b.x === a.x ? 0 : (b.y - a.y) / (b.x - a.x); return toSeg(a.x, a.y, a.x + far, a.y + k * far); }
    // rect / fib: inside the box counts as a hit
    const inside = x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x) && y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y);
    return inside ? 0 : Infinity;
  }

  // Wire a pane: tool <select>, pointer handling on the overlay canvas.
  function attach(pane, select) {
    const cv = pane.canvas, wrap = cv.parentElement;
    const setTool = tool => {
      pane.tool = tool; pane.pending = null; select.value = tool;
      wrap.classList.toggle('drawing', !!tool);
      pane.scheduleDraw();
    };
    select.onchange = () => {
      if (select.value === 'clear') {
        if (list(pane.drawKey()).length && confirm(`Delete all drawings on ${pane.cfg.symbol}?`)) { all[pane.drawKey()] = []; changed(pane); }
        return setTool('');
      }
      setTool(select.value);
    };
    const pt = e => {
      const r = cv.getBoundingClientRect(), G = geometry(pane), x = e.clientX - r.left, y = e.clientY - r.top;
      return { x, y, q: { t: Math.round(G.t(x)), p: G.p(y) } };
    };
    cv.addEventListener('pointerdown', e => {
      if (!pane.tool || !pane.bars.length) return;
      const { x, y, q } = pt(e);
      if (q.p == null) return;
      const items = list(pane.drawKey());
      if (pane.tool === 'erase') {
        let best = -1, bd = 6;
        items.forEach((d, i) => { const dd = distance(pane, d, x, y); if (dd <= bd) { bd = dd; best = i; } });
        if (best >= 0) { items.splice(best, 1); changed(pane); }
        return;
      }
      if (pane.tool === 'hline') { items.push({ type: 'hline', pts: [q] }); changed(pane); return setTool(''); }
      if (!pane.pending) { pane.pending = { type: pane.tool, pts: [q, q] }; return; }
      pane.pending.pts[1] = q;
      items.push(pane.pending);
      changed(pane);
      setTool('');
    });
    cv.addEventListener('pointermove', e => {
      if (!pane.pending) return;
      const { q } = pt(e);
      if (q.p != null) { pane.pending.pts[1] = q; pane.scheduleDraw(); }
    });
    pane.setTool = setTool;
  }

  function changed(pane) {
    const key = pane.drawKey();
    save(key);
    panes.forEach(p => p.drawKey() === key && p.scheduleDraw());
  }

  document.addEventListener('keydown', e => { if (e.key === 'Escape') panes.forEach(p => p.tool && p.setTool('')); });

  const options = () => `<option value="">✎ Draw</option>${TOOLS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}` +
    '<option value="erase">Eraser</option><option value="clear">Clear all</option>';

  return { load, render, attach, options };
})();
