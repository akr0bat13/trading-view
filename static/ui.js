// TradingView-style chrome: top toolbar, drawing toolbar, symbol/indicator dialogs, watchlist, shortcuts.
const UI = (() => {
  const $ = s => document.querySelector(s);
  const svg = (inner) => `<svg viewBox="0 0 24 24">${inner}</svg>`;
  const dot = (x, y) => `<circle cx="${x}" cy="${y}" r="1.8"/>`;
  const ICON = {
    cursor: svg('<path d="M6 3l12 9-5.5 1.2L15 20l-2.4 1-2.5-6.6L6 18z"/>'),
    trend: svg('<path d="M5.5 18.5l13-13"/>' + dot(4.5, 19.5) + dot(19.5, 4.5)),
    ray: svg('<path d="M5.5 18.5L21 3"/>' + dot(4.5, 19.5) + dot(12, 12)),
    ext: svg('<path d="M2 22L22 2"/>' + dot(8, 16) + dot(16, 8)),
    hline: svg('<path d="M2 12h8.2M13.8 12H22"/>' + dot(12, 12)),
    hray: svg('<path d="M8 12h14"/>' + dot(6, 12)),
    vline: svg('<path d="M12 2v8.2M12 13.8V22"/>' + dot(12, 12)),
    cross: svg('<path d="M2 12h20M12 2v20"/>'),
    rect: svg('<rect x="4" y="6" width="16" height="12" rx="1"/>' + dot(4, 6) + dot(20, 18)),
    fib: svg('<path d="M3 5h18M3 9.5h18M3 14h18M3 19h18"/>'),
    channel: svg('<path d="M3 15L15 3M9 21L21 9"/>' + dot(3, 15) + dot(15, 3) + dot(15, 15)),
    text: svg('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'),
    magnet: svg('<path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4zM6 8h4M14 8h4"/>'),
    eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    eyeOff: svg('<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.7-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
    undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
    edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
    trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
    search: svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M20 20l-5-5"/>'),
    keyboard: svg('<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h1M10 10h1M14 10h1M18 10h0M7 14h10"/>'),
    list: svg('<path d="M8 6h13M8 12h13M8 18h13M3.5 6h0M3.5 12h0M3.5 18h0"/>'),
    cursor2: svg('<path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="3"/>'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    bell: svg('<path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15zM10 21a2 2 0 0 0 4 0"/>'),
    camera: svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
    layout: svg('<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>'),
    info: svg('<path d="M4 18L15 7"/><rect x="12" y="13" width="9" height="6" rx="1"/>'),
    angle: svg('<path d="M4 19h16M4 19L17 7M10 19a6 6 0 0 0-2-4"/>'),
    flat: svg('<path d="M4 18L16 8M4 5h12M16 5v3"/>'),
    pitchfork: svg('<path d="M3 12h18M6 6l15 6M6 18l15-6"/>'),
    fibext: svg('<path d="M3 4l5 6 4-3M3 12h18M3 16h18M3 20h18"/>'),
    fibtz: svg('<path d="M5 3v18M9 3v18M14 3v18M20 3v18"/>'),
    fibfan: svg('<path d="M4 20L20 4M4 20L20 9M4 20L20 14"/>'),
    gannfan: svg('<path d="M4 20L20 4M4 20L20 8M4 20L20 12M4 20L11 4"/>'),
    gannbox: svg('<rect x="4" y="4" width="16" height="16"/><path d="M4 4l16 16M12 4v16M4 12h16"/>'),
    xabcd: svg('<path d="M3 17l4-10 5 8 4-9 5 11"/>'),
    cypher: svg('<path d="M3 18l5-12 5 9 4-6 4 8"/>'),
    abcd: svg('<path d="M4 18l5-12 6 9 5-11"/>'),
    hs: svg('<path d="M2 18l3-5 3 4 4-10 4 10 3-4 3 5"/>'),
    drives: svg('<path d="M2 19l3-6 2 3 3-8 2 5 3-9 2 5"/>'),
    elliott: svg('<path d="M3 19l4-6 3 3 5-10 3 6 3-3"/>'),
    elliottc: svg('<path d="M4 6l6 8 3-4 6 9"/>'),
    cycles: svg('<path d="M4 3v18M10 3v18M16 3v18M22 3v18"/>'),
    long: svg('<rect x="4" y="4" width="16" height="9"/><rect x="4" y="13" width="16" height="6"/>'),
    short: svg('<rect x="4" y="5" width="16" height="6"/><rect x="4" y="11" width="16" height="9"/>'),
    forecast: svg('<path d="M4 18L18 6M13 6h5v5"/>'),
    avwap: svg('<path d="M3 17c5 0 6-8 18-9"/><circle cx="3.5" cy="17" r="1.5"/>'),
    daterange: svg('<path d="M4 12h16M4 8v8M20 8v8M8 9l-4 3 4 3M16 9l4 3-4 3"/>'),
    dprange: svg('<rect x="4" y="6" width="16" height="12"/><path d="M12 6v12M4 12h16"/>'),
    brush: svg('<path d="M4 20c4 0 5-4 7-6l6-8 2 2-8 6c-2 2-3 6-7 6z"/>'),
    highlighter: svg('<path d="M5 19h6M8 15l8-8 3 3-8 8z"/>'),
    arrowup: svg('<path d="M12 20V6M6 11l6-6 6 6"/>'),
    arrowdown: svg('<path d="M12 4v14M6 13l6 6 6-6"/>'),
    marker: svg('<path d="M12 21s-6-6-6-11a6 6 0 0 1 12 0c0 5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>'),
    circle: svg('<circle cx="12" cy="12" r="8"/>'),
    note: svg('<path d="M5 4h14v12h-6l-4 4v-4H5z"/>'),
    pricelabel: svg('<path d="M3 12l5-5h13v10H8z"/>'),
    flag: svg('<path d="M6 21V4M6 5h12l-3 4 3 4H6"/>'),
    arrow: svg('<path d="M5 19L19 5M10 5h9v9"/>'),
    triangle: svg('<path d="M4 19L12 5l8 14z"/>'),
    ellipse: svg('<ellipse cx="12" cy="12" rx="9" ry="6"/>'),
    range: svg('<path d="M4 5h16M4 19h16M12 5v14M9 8l3-3 3 3M9 16l3 3 3-3"/>'),
    lock: svg('<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
    unlock: svg('<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
  };
  const TF_LABEL = { '1d': 'D', '1w': 'W', '1M': 'M' };
  const GROUPS = [ // [group title, [[tool, title, shortcut, section heading shown above it], ...]]; the toolbar shows one button per group
    ['Lines', [['trend', 'Trend line', 'Alt+T', 'Lines'], ['info', 'Info line'], ['angle', 'Trend angle'], ['ray', 'Ray'], ['ext', 'Extended line'],
      ['hline', 'Horizontal line', 'Alt+H'], ['hray', 'Horizontal ray', 'Alt+J'], ['vline', 'Vertical line', 'Alt+V'], ['cross', 'Cross line', 'Alt+C'],
      ['channel', 'Parallel channel', '', 'Channels'], ['flat', 'Flat top/bottom'], ['pitchfork', 'Pitchfork', '', 'Pitchforks']]],
    ['Fibonacci & Gann', [['fib', 'Fib retracement', 'Alt+F', 'Fibonacci'], ['fibext', 'Trend-based fib extension'], ['fibtz', 'Fib time zones'], ['fibfan', 'Fib speed resistance fan'],
      ['gannfan', 'Gann fan', '', 'Gann'], ['gannbox', 'Gann box']]],
    ['Patterns', [['xabcd', 'XABCD pattern', '', 'Chart patterns'], ['cypher', 'Cypher pattern'], ['abcd', 'ABCD pattern'], ['hs', 'Head and shoulders'], ['drives', 'Three drives pattern'],
      ['elliott', 'Elliott impulse wave (12345)', '', 'Elliott waves'], ['elliottc', 'Elliott correction wave (ABC)'], ['cycles', 'Time cycles', '', 'Cycles']]],
    ['Forecasting & measure', [['long', 'Long position', '', 'Forecasting'], ['short', 'Short position'], ['forecast', 'Forecast'], ['avwap', 'Anchored VWAP', '', 'Volume-based'],
      ['range', 'Price range', '', 'Ranges'], ['daterange', 'Date range'], ['dprange', 'Date and price range']]],
    ['Brushes & arrows', [['brush', 'Brush', '', 'Brushes'], ['highlighter', 'Highlighter'], ['arrow', 'Arrow', '', 'Arrows'], ['arrowup', 'Arrow up'], ['arrowdown', 'Arrow down'], ['marker', 'Arrow marker']]],
    ['Shapes', [['rect', 'Rectangle', 'Alt+Shift+R'], ['circle', 'Circle'], ['ellipse', 'Ellipse'], ['triangle', 'Triangle']]],
    ['Text & notes', [['text', 'Text'], ['note', 'Note'], ['pricelabel', 'Price label'], ['flag', 'Flag']]],
  ];
  const TOOLS = GROUPS.flatMap(g => g[1]);
  const SHORTCUTS = [
    ['Start typing', 'Symbol search'], ['/', 'Indicators'], ['?', 'This list'], ['Esc', 'Cancel drawing / deselect / close dialog'],
    ['Click a drawing', 'Select it; drag to move, drag a point to reshape'], ['Delete / Backspace', 'Remove selected drawing'],
    ['Ctrl/Cmd+Z', 'Undo drawing change'], ['Ctrl/Cmd+Shift+Z', 'Redo'], ['Double-click text', 'Edit text'],
    ...TOOLS.filter(t => t && t[2] && t[0]).map(t => [t[2], t[1]]),
    ['Alt+I', 'Invert (flip) price scale'], ['Alt+L', 'Log scale'], ['Alt+R', 'Reset chart view'], ['Alt+W', 'Show / hide watchlist'], ['Alt+S', 'Save chart as PNG'], ['Alt+M or double-click header', 'Maximize chart (Esc restores)'],
  ];
  const KEYMAP = { KeyT: 'trend', KeyH: 'hline', KeyJ: 'hray', KeyV: 'vline', KeyC: 'cross', KeyF: 'fib' };

  // ---------- header ----------
  function syncHeader() {
    const p = activePane();
    if (!p) return;
    $('#sym-btn').innerHTML = `${ICON.search}${p.cfg.symbol}`;
    document.querySelectorAll('#tfs .tb').forEach(b => b.classList.toggle('on', b.dataset.tf === p.cfg.tf));
    $('#tf-sel').value = p.cfg.tf;
    document.querySelectorAll('.wl-row').forEach(r => r.classList.toggle('cur', r.dataset.key === p.drawKey()));
    if ($('#type-sel')) $('#type-sel').value = p.cfg.type || 'candles';
    $('#sync-cursor')?.classList.toggle('on', !!S.syncCursor);
    $('#sync-symbol')?.classList.toggle('on', !!S.syncSymbol);
    syncDrawToolbar();
    Trading.syncSymbol();
  }

  const groupTool = i => GROUPS[i][1].find(t => t[0] === S.lastTool?.[i]) || GROUPS[i][1][0];
  function openFlyout(i, anchor) {
    const fly = $('#fly');
    if (!fly.hidden && fly.dataset.g == i) return closeFlyout();
    fly.dataset.g = i; fly.hidden = false;
    fly.innerHTML = GROUPS[i][1].map(t =>
      `${t[3] ? `<div class="fly-head">${t[3]}</div>` : ''}<button class="fly-item" data-tool="${t[0]}">${ICON[t[0]]}<span>${t[1]}</span>${t[2] ? `<kbd>${t[2]}</kbd>` : ''}</button>`).join('');
    fly.querySelectorAll('.fly-item').forEach(b => b.onclick = () => { Draw.setTool(b.dataset.tool); closeFlyout(); });
    const r = anchor.getBoundingClientRect();
    fly.style.left = r.right + 4 + 'px'; fly.style.top = Math.max(4, Math.min(r.top, innerHeight - fly.offsetHeight - 4)) + 'px';
    syncTools();
  }
  const closeFlyout = () => { $('#fly').hidden = true; };

  function syncTools() {
    GROUPS.forEach((g, i) => { // a group button shows (and starts) the tool last used from it
      if (g[1].some(t => t[0] === Draw.tool)) (S.lastTool ||= {})[i] = Draw.tool;
      const t = groupTool(i), b = document.querySelector(`#tools .main[data-g="${i}"]`);
      b.innerHTML = ICON[t[0]]; b.dataset.tool = t[0]; b.title = `${g[0]}: ${t[1]}${t[2] ? ` (${t[2]})` : ''}`;
      b.classList.toggle('on', g[1].some(x => x[0] === Draw.tool));
    });
    document.querySelector('#tools [data-tool=""]')?.classList.toggle('on', !Draw.tool);
    document.querySelectorAll('#fly .fly-item').forEach(b => b.classList.toggle('on', b.dataset.tool === Draw.tool));
    $('#lock-btn')?.classList.toggle('on', !!S.lockDrawings);
    if ($('#lock-btn')) $('#lock-btn').innerHTML = S.lockDrawings ? ICON.lock : ICON.unlock;
    $('#magnet-btn')?.classList.toggle('on', !!S.magnet);
    if ($('#hide-btn')) { $('#hide-btn').innerHTML = S.hideDrawings ? ICON.eyeOff : ICON.eye; $('#hide-btn').classList.toggle('on', !!S.hideDrawings); }
  }

  // floating toolbar for the selected drawing: color, width, style, edit text, delete
  function syncDrawToolbar() {
    document.querySelector('.dtb')?.remove();
    const sel = Draw.sel, p = activePane();
    if (!sel || !p || p.drawKey() !== sel.key) return;
    const d = sel.d, bar = document.createElement('div');
    bar.className = 'dtb';
    const color = Draw.colorOf(d), width = d.width || 1.5, dash = d.dash || 'solid';
    bar.innerHTML = `<button class="tb" data-a="color" title="Color"><span class="swatch" style="background:${color}"></span></button>
      <div class="palette">${Draw.PALETTE.map(c => `<button style="background:${c}" data-c="${c}"></button>`).join('')}</div>`
      + (['text', 'note'].includes(d.type) ? `<button class="tb" data-a="edit" title="Edit text">${ICON.edit}</button>`
        : `<button class="tb" data-a="width" title="Line width"><span class="lw" style="height:${width}px"></span></button>
           <button class="tb" data-a="dash" title="Line style">${{ solid: '━', dash: '╍', dot: '┈' }[dash]}</button>`)
      + (['hline', 'hray'].includes(d.type) ? `<button class="tb ${d.alert ? 'on' : ''}" data-a="alert" title="Alert when price crosses this line">${ICON.bell}</button>` : '')
      + `<span class="sep"></span><button class="tb" data-a="del" title="Delete (Del)">${ICON.trash}</button>`;
    bar.addEventListener('pointerdown', e => e.stopPropagation());
    bar.onclick = e => {
      const a = e.target.closest('[data-a]')?.dataset.a, c = e.target.closest('[data-c]')?.dataset.c;
      if (c) return Draw.update({ color: c });
      if (a === 'color') return bar.classList.toggle('pal');
      if (a === 'width') return Draw.update({ width: { 1: 2, 1.5: 2, 2: 3, 3: 1 }[width] });
      if (a === 'dash') return Draw.update({ dash: { solid: 'dash', dash: 'dot', dot: 'solid' }[dash] });
      if (a === 'edit') return Draw.editText(p, d);
      if (a === 'del') return Draw.remove();
      if (a === 'alert') return Draw.update({ alert: Alerts.arm(!d.alert) });
    };
    p.canvas.parentElement.append(bar);
  }


  // ---------- symbol search ----------
  let symMode = 'pane', symTab = 'all', hl = 0;
  function openSymbolSearch(initial = '', mode = 'pane') {
    symMode = mode;
    $('#sym-dlg .dlg-title').textContent = mode === 'watch' ? 'Add to watchlist' : 'Symbol search';
    $('#sym-q').value = initial;
    $('#sym-dlg').showModal();
    $('#sym-q').focus();
    renderSymbols();
  }
  function symbolItems() {
    const q = $('#sym-q').value.trim(), Q = q.toUpperCase();
    const srcs = Object.entries(META.sources).filter(([k]) => symTab === 'all' || symTab === k);
    const items = [];
    for (const [k, s] of srcs) for (const sym of s.symbols) if (!Q || sym.toUpperCase().includes(Q)) items.push([k, sym]);
    if (q) for (const [k] of srcs) if (!items.some(([kk, sym]) => kk === k && sym.toUpperCase() === Q)) items.push([k, normSymbol(k, q), true]);
    return items;
  }
  function renderSymbols() {
    const items = symbolItems();
    hl = Math.min(hl, items.length - 1);
    $('#sym-tabs').innerHTML = [['all', 'All'], ...Object.entries(META.sources).map(([k, s]) => [k, s.label])]
      .map(([k, l]) => `<button class="tb ${k === symTab ? 'on' : ''}" data-k="${k}">${l}</button>`).join('');
    $('#sym-tabs').querySelectorAll('.tb').forEach(b => b.onclick = () => { symTab = b.dataset.k; renderSymbols(); $('#sym-q').focus(); });
    $('#sym-list').innerHTML = items.map(([k, sym, typed], i) =>
      `<div class="item ${i === hl ? 'hl' : ''}" data-i="${i}"><b>${sym}</b>${typed ? '<span class="hint">use as ticker</span>' : ''}<span class="sub">${META.sources[k].label}</span></div>`).join('')
      || '<div class="item"><span class="sub">Nothing found</span></div>';
    $('#sym-list').querySelectorAll('.item[data-i]').forEach(el => el.onclick = () => pickSymbol(items[+el.dataset.i]));
  }
  function pickSymbol([source, symbol]) {
    $('#sym-dlg').close();
    if (symMode === 'watch') {
      if (!S.watch.some(w => w.source === source && w.symbol === symbol)) { S.watch.push({ source, symbol }); saveConfigs(); Watch.build(); }
    } else activePane().setSymbol(source, symbol);
  }

  // ---------- indicators ----------
  function openIndicators() {
    $('#ind-q').value = '';
    $('#ind-dlg').showModal();
    $('#ind-q').focus();
    renderIndicators();
  }
  function renderIndicators() {
    const q = $('#ind-q').value.trim().toLowerCase(), p = activePane();
    const groups = [...new Set(INDICATORS.map(d => d.group))];
    $('#ind-list').innerHTML = groups.map(g => {
      const rows = INDICATORS.filter(d => d.group === g && d.name.toLowerCase().includes(q));
      return rows.length ? `<div class="grp">${g}</div>` + rows.map(d => {
        const n = p.cfg.ind.filter(i => i.type === d.type).length;
        return `<div class="item" data-t="${d.type}"><span class="chk">${n ? (d.single ? '✓' : n) : ''}</span>${d.name}${g === 'PRO' ? ' <span class="pro">PRO</span>' : ''}`
          + `${n && d.single ? '<span class="hint">click to remove</span>' : !d.single ? '<span class="hint">click to add</span>' : ''}</div>`;
      }).join('') : '';
    }).join('');
    $('#ind-list').querySelectorAll('.item').forEach(el => el.onclick = () => {
      const t = el.dataset.t, d = IND[t];
      if (d.single && p.hasInd(t)) p.removeInd(p.cfg.ind.find(i => i.type === t).id);
      else p.addInd(t);
      renderIndicators();
    });
  }

  // settings of one indicator instance: params + color, applied live
  function openIndSettings(pane, id) {
    const inst = pane.cfg.ind.find(i => i.id === id), d = IND[inst.type];
    if (!inst) return;
    $('#cfg-title').textContent = d.name;
    $('#cfg-body').innerHTML = (d.params || []).map(x => `<label class="field"><span>${x.label}</span><input type="number" step="${x.step}" min="${x.step}" data-k="${x.k}" value="${inst.params[x.k]}"></label>`).join('')
      + (d.color ? `<label class="field"><span>Color</span><input type="color" id="cfg-color" value="${/^#[0-9a-f]{6}$/i.test(indColor(inst)) ? indColor(inst) : '#2962ff'}"></label>` : '');
    const apply = () => {
      $('#cfg-body').querySelectorAll('input[data-k]').forEach(el => { const v = +el.value; if (v > 0) inst.params[el.dataset.k] = v; });
      const c = $('#cfg-color'); if (c && c.dataset.touched) inst.color = c.value;
      saveConfigs(); pane.buildIndicators();
    };
    $('#cfg-body').oninput = e => { if (e.target.id === 'cfg-color') e.target.dataset.touched = 1; apply(); };
    $('#cfg-remove').onclick = () => { $('#cfg-dlg').close(); pane.removeInd(id); };
    $('#cfg-reset').onclick = () => { inst.params = defaultParams(d); delete inst.color; saveConfigs(); pane.buildIndicators(); $('#cfg-dlg').close(); };
    $('#cfg-dlg').showModal();
  }

  // ---------- layouts ----------
  function renderLayouts() {
    $('#lay-list').innerHTML = Layouts.list().map(l => `<div class="item" data-n="${l.name.replace(/"/g, '&quot;')}"><b></b><span class="hint">${l.count} chart${l.count > 1 ? 's' : ''}</span><button class="tb icon" data-a="del" title="Delete">✕</button></div>`).join('')
      || '<div class="item"><span class="hint">No saved layouts yet</span></div>';
    $('#lay-list').querySelectorAll('.item[data-n]').forEach(el => {
      el.querySelector('b').textContent = el.dataset.n;
      el.onclick = e => {
        if (e.target.closest('[data-a=del]')) { Layouts.remove(el.dataset.n); return renderLayouts(); }
        $('#lay-dlg').close(); Layouts.apply(el.dataset.n);
      };
    });
  }
  function saveLayout() {
    const name = $('#lay-name').value.trim();
    if (!name) return $('#lay-name').focus();
    Layouts.save(name); $('#lay-name').value = ''; renderLayouts();
  }

  // ---------- shortcuts ----------
  function onKey(e) {
    if (document.querySelector('dialog[open]')) return;
    if (e.target.closest('input, textarea, select')) return;
    const p = activePane(), alt = e.altKey && !e.ctrlKey && !e.metaKey;
    if (e.key === 'Escape') {
      closeFlyout();
      if (Draw.tool || Draw.sel) { Draw.setTool(''); return Draw.deselect(); }
      return isMax() && toggleMax();
    }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); return e.shiftKey ? Draw.redo() : Draw.undo(); }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); return Draw.redo(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && Draw.sel) { e.preventDefault(); return Draw.remove(); }
    if (alt) {
      const act = e.shiftKey ? { KeyR: () => Draw.setTool('rect') }[e.code] : {
        ...Object.fromEntries(Object.entries(KEYMAP).map(([c, t]) => [c, () => Draw.setTool(t)])),
        KeyI: () => p.toggleScale('invert'), KeyL: () => p.toggleScale('log'), KeyR: () => p.resetView(),
        KeyW: () => toggleWatchlist(), KeyS: () => p.screenshot(), KeyM: () => toggleMax(),
      }[e.code];
      if (act) { e.preventDefault(); act(); }
      return;
    }
    if (e.ctrlKey || e.metaKey) return;
    if (e.key === '/') { e.preventDefault(); return openIndicators(); }
    if (e.key === '?') { e.preventDefault(); return $('#help-dlg').showModal(); }
    if (/^[\w^.]$/.test(e.key)) { e.preventDefault(); openSymbolSearch(e.key); }
  }

  function toggleWatchlist() {
    S.wl = !S.wl; saveConfigs();
    document.body.classList.toggle('no-wl', !S.wl);
  }

  function init() {
    $('#sym-btn').onclick = () => openSymbolSearch();
    $('#tfs').innerHTML = META.timeframes.map(t => `<button class="tb" data-tf="${t}">${TF_LABEL[t] || t}</button>`).join('');
    $('#tfs').querySelectorAll('.tb').forEach(b => b.onclick = () => activePane().setTf(b.dataset.tf));
    $('#tf-sel').innerHTML = META.timeframes.map(t => `<option value="${t}">${TF_LABEL[t] || t}</option>`).join('');
    $('#tf-sel').onchange = () => { activePane().setTf($('#tf-sel').value); $('#tf-sel').blur(); };
    $('#type-sel').innerHTML = [['candles', 'Candles'], ['heikin', 'Heikin Ashi'], ['bars', 'Bars'], ['line', 'Line'], ['area', 'Area']].map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
    $('#type-sel').onchange = () => { activePane().setType($('#type-sel').value); $('#type-sel').blur(); };
    $('#ind-btn').innerHTML = '<i style="font-family:serif;font-style:italic">ƒx</i> Indicators';
    $('#ind-btn').onclick = openIndicators;
    $('#counts').innerHTML = COUNTS.map(n => `<button class="tb">${n}</button>`).join('');
    $('#counts').querySelectorAll('.tb').forEach(b => b.onclick = () => setCount(+b.textContent));
    $('#sync-cursor').innerHTML = ICON.cursor2;
    $('#sync-symbol').innerHTML = ICON.link;
    $('#sync-cursor').onclick = () => { S.syncCursor = !S.syncCursor; saveConfigs(); if (!S.syncCursor) panes.forEach(p => p.setCursor(null)); syncHeader(); };
    $('#sync-symbol').onclick = () => {
      S.syncSymbol = !S.syncSymbol; saveConfigs();
      if (S.syncSymbol) { const a = activePane(); panes.forEach(p => p !== a && p.setSymbol(a.cfg.source, a.cfg.symbol, true)); }
      syncHeader();
    };
    $('#lay-btn').innerHTML = ICON.layout;
    $('#lay-btn').onclick = () => { renderLayouts(); $('#lay-dlg').showModal(); $('#lay-name').focus(); };
    $('#lay-save').onclick = saveLayout;
    $('#lay-name').onkeydown = e => e.key === 'Enter' && saveLayout();
    $('#shot-btn').innerHTML = ICON.camera;
    $('#shot-btn').onclick = () => activePane().screenshot();
    $('#help-btn').innerHTML = ICON.keyboard;
    $('#help-btn').onclick = () => $('#help-dlg').showModal();
    $('#wl-btn').innerHTML = ICON.list;
    $('#wl-btn').onclick = toggleWatchlist;
    document.body.classList.toggle('no-wl', !S.wl);

    $('#tools').innerHTML = `<button class="tb" data-tool="" title="Cursor (Esc)">${ICON.cursor}</button><span class="sep"></span>`
      + GROUPS.map((g, i) => `<div class="grp"><button class="tb main" data-g="${i}"></button><button class="caret" data-g="${i}" title="${g[0]}">›</button></div>`).join('')
      + `<span class="sep"></span>
      <button class="tb" id="magnet-btn" title="Magnet: snap to open/high/low/close">${ICON.magnet}</button>
      <button class="tb" id="lock-btn" title="Lock drawings (can't be selected or moved)"></button>
      <button class="tb" id="hide-btn" title="Hide all drawings"></button>
      <button class="tb" id="undo-btn" title="Undo (Ctrl/Cmd+Z)">${ICON.undo}</button>
      <button class="tb" id="clear-btn" title="Remove all drawings on this symbol">${ICON.trash}</button>`;
    $('#tools [data-tool=""]').onclick = () => Draw.setTool('');
    document.querySelectorAll('#tools .main').forEach(b => b.onclick = () => { closeFlyout(); Draw.setTool(b.dataset.tool); });
    document.querySelectorAll('#tools .caret').forEach(b => b.onclick = e => { e.stopPropagation(); openFlyout(+b.dataset.g, b.parentElement); });
    document.addEventListener('click', e => e.target.closest('#fly, .caret') || closeFlyout());
    $('#clear-btn').onclick = () => Draw.clear(activePane());
    $('#lock-btn').onclick = () => { S.lockDrawings = !S.lockDrawings; Draw.deselect?.(); saveConfigs(); syncTools(); panes.forEach(p => p.scheduleDraw()); };
    $('#magnet-btn').onclick = () => { S.magnet = !S.magnet; saveConfigs(); syncTools(); };
    $('#hide-btn').onclick = () => { S.hideDrawings = !S.hideDrawings; saveConfigs(); syncTools(); panes.forEach(p => p.scheduleDraw()); };
    $('#undo-btn').onclick = () => Draw.undo();
    syncTools();

    document.querySelectorAll('.dlg .x').forEach(b => b.onclick = () => b.closest('dialog').close());
    document.querySelectorAll('.dlg').forEach(d => d.addEventListener('click', e => e.target === d && d.close())); // backdrop click
    $('#sym-q').oninput = () => { hl = 0; renderSymbols(); };
    $('#sym-q').onkeydown = e => {
      const n = symbolItems().length;
      if (e.key === 'ArrowDown') { hl = Math.min(n - 1, hl + 1); renderSymbols(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { hl = Math.max(0, hl - 1); renderSymbols(); e.preventDefault(); }
      if (e.key === 'Enter' && n) pickSymbol(symbolItems()[hl]);
    };
    $('#ind-q').oninput = renderIndicators;
    $('#help-list').innerHTML = SHORTCUTS.map(([k, v]) => `<div class="item">${v}<kbd>${k}</kbd></div>`).join('');
    // toolbar buttons must not keep focus: after a dialog closes, focus returns there and Enter would re-click them
    document.addEventListener('click', e => e.target.closest('button.tb')?.blur());
    document.addEventListener('keydown', onKey);
    Watch.build();
  }

  return { init, syncHeader, syncTools, syncDrawToolbar, openSymbolSearch, openIndSettings, ICON };
})();

// ---------- watchlist ----------
const Watch = (() => {
  const quotes = {}; // "crypto:BTC" -> {price, prev}
  let rows = {}, timer;
  const key = w => `${w.source}:${w.symbol}`;

  function build() {
    const el = document.getElementById('watchlist');
    el.innerHTML = `<div class="wl-head">Watchlist<span class="spacer"></span><button class="tb icon" title="Add symbol">${UI.ICON.plus}</button></div>
      <div class="wl-cols"><span>Symbol</span><span>Last</span><span>Chg%</span></div><div class="wl-body"></div>`;
    el.querySelector('.wl-head .tb').onclick = () => UI.openSymbolSearch('', 'watch');
    const body = el.querySelector('.wl-body');
    rows = {};
    for (const [src, s] of Object.entries(META.sources)) {
      const items = S.watch.filter(w => w.source === src);
      if (!items.length) continue;
      body.insertAdjacentHTML('beforeend', `<div class="wl-sec">${s.label}</div>`);
      for (const w of items) {
        const row = document.createElement('div');
        row.className = 'wl-row'; row.dataset.key = key(w);
        row.innerHTML = `<b></b><span class="last">—</span><span class="pct"></span><button class="rm" title="Remove">✕</button>`;
        row.querySelector('b').textContent = w.symbol;
        row.onclick = () => activePane().setSymbol(w.source, w.symbol);
        row.querySelector('.rm').onclick = e => { e.stopPropagation(); S.watch.splice(S.watch.indexOf(w), 1); saveConfigs(); build(); };
        body.append(row);
        rows[key(w)] = row;
        paint(key(w));
      }
    }
    UI.syncHeader();
    poll();
  }

  function paint(k, flash) {
    const row = rows[k], q = quotes[k];
    if (!row || !q) return;
    const last = row.querySelector('.last'), pct = row.querySelector('.pct'), old = row.dataset.px;
    last.textContent = fmtPrice(q.price);
    if (q.prev) {
      const ch = (q.price - q.prev) / q.prev * 100;
      pct.textContent = `${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%`;
      pct.className = 'pct ' + (ch >= 0 ? 'up' : 'down');
    }
    if (flash && old && +old !== q.price) {
      row.classList.remove('flash-up', 'flash-down'); void row.offsetWidth;
      row.classList.add(q.price > +old ? 'flash-up' : 'flash-down');
    }
    row.dataset.px = q.price;
  }

  async function poll() {
    clearTimeout(timer);
    const bySrc = {};
    S.watch.forEach(w => (bySrc[w.source] ||= []).push(w.symbol));
    await Promise.all(Object.entries(bySrc).map(async ([source, syms]) => {
      try {
        const r = await (await fetch(`/api/quotes?${new URLSearchParams({ source, symbols: syms.join(',') })}`)).json();
        for (const [sym, q] of Object.entries(r)) { const k = `${source}:${sym}`; quotes[k] = { ...quotes[k], ...q }; paint(k, true); }
      } catch { }
    }));
    timer = setTimeout(poll, 30000);
  }

  // live crypto prices between polls (Hyperliquid allMids), repainted at most once a second
  let pendingMids = null;
  HL.onMids = mids => {
    if (!pendingMids) setTimeout(() => {
      for (const [coin, px] of Object.entries(pendingMids)) {
        const k = 'crypto:' + coin;
        if (rows[k]) { quotes[k] = { ...quotes[k], price: +px }; paint(k, true); }
      }
      pendingMids = null;
    }, 1000);
    pendingMids = mids;
  };

  return { build };
})();

// ---------- alerts on horizontal lines ----------
// A line with alert=true fires once when the live price crosses it (the page must be open): toast, beep, desktop notification.
const Alerts = (() => {
  let ctx;
  function beep() {
    try {
      ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.22].forEach(t => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.15, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.18);
        o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
      });
    } catch { }
  }
  // called from a click: unlocks audio and asks for notification permission
  function arm(on) {
    if (on) {
      try { ctx ||= new (window.AudioContext || window.webkitAudioContext)(); ctx.resume(); } catch { }
      if (window.Notification && Notification.permission === 'default') Notification.requestPermission();
    }
    return on;
  }
  function fire(pane, d, price) {
    const msg = `${pane.cfg.symbol} crossed ${fmtPrice(d.pts[0].p)} (now ${fmtPrice(price)})`;
    beep();
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = '🔔 ' + msg;
    t.onclick = () => t.remove();
    document.getElementById('toasts').append(t);
    setTimeout(() => t.remove(), 15000);
    try { if (window.Notification && Notification.permission === 'granted') new Notification('Price alert', { body: msg }); } catch { }
  }
  function check(pane, prev, price) {
    if (prev == null || prev === price) return;
    let hit = false;
    for (const d of Draw.list(pane.drawKey())) {
      if (!d.alert) continue;
      const level = d.pts[0].p;
      if ((prev < level && price >= level) || (prev > level && price <= level)) { d.alert = false; fire(pane, d, price); hit = true; }
    }
    if (hit) { Draw.changed(); UI.syncDrawToolbar(); }
  }
  return { check, arm };
})();
