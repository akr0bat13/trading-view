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
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
  };
  const TF_LABEL = { '1d': 'D', '1w': 'W', '1M': 'M' };
  const TOOLS = [ // [tool, title, shortcut]
    ['', 'Cursor', 'Esc'], null,
    ['trend', 'Trend line', 'Alt+T'], ['ray', 'Ray'], ['ext', 'Extended line'], ['hline', 'Horizontal line', 'Alt+H'],
    ['hray', 'Horizontal ray', 'Alt+J'], ['vline', 'Vertical line', 'Alt+V'], ['cross', 'Cross line', 'Alt+C'], null,
    ['channel', 'Parallel channel'], ['rect', 'Rectangle', 'Alt+Shift+R'], ['fib', 'Fib retracement', 'Alt+F'], null,
    ['text', 'Text'],
  ];
  const SHORTCUTS = [
    ['Start typing', 'Symbol search'], ['/', 'Indicators'], ['?', 'This list'], ['Esc', 'Cancel drawing / deselect / close dialog'],
    ['Click a drawing', 'Select it; drag to move, drag a point to reshape'], ['Delete / Backspace', 'Remove selected drawing'],
    ['Ctrl/Cmd+Z', 'Undo drawing change'], ['Ctrl/Cmd+Shift+Z', 'Redo'], ['Double-click text', 'Edit text'],
    ...TOOLS.filter(t => t && t[2] && t[0]).map(t => [t[2], t[1]]),
    ['Alt+I', 'Invert (flip) price scale'], ['Alt+L', 'Log scale'], ['Alt+R', 'Reset chart view'], ['Alt+W', 'Show / hide watchlist'],
  ];
  const KEYMAP = { KeyT: 'trend', KeyH: 'hline', KeyJ: 'hray', KeyV: 'vline', KeyC: 'cross', KeyF: 'fib' };

  // ---------- header ----------
  function syncHeader() {
    const p = activePane();
    if (!p) return;
    $('#sym-btn').innerHTML = `${ICON.search}${p.cfg.symbol}`;
    document.querySelectorAll('#tfs .tb').forEach(b => b.classList.toggle('on', b.dataset.tf === p.cfg.tf));
    document.querySelectorAll('.wl-row').forEach(r => r.classList.toggle('cur', r.dataset.key === p.drawKey()));
    syncDrawToolbar();
  }

  function syncTools() {
    document.querySelectorAll('#tools .tb[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === Draw.tool));
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
      + (d.type === 'text' ? `<button class="tb" data-a="edit" title="Edit text">${ICON.edit}</button>`
        : `<button class="tb" data-a="width" title="Line width"><span class="lw" style="height:${width}px"></span></button>
           <button class="tb" data-a="dash" title="Line style">${{ solid: '━', dash: '╍', dot: '┈' }[dash]}</button>`)
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
    const q = $('#ind-q').value.trim().toLowerCase(), on = activePane().cfg.ind;
    const groups = [...new Set(INDICATORS.map(d => d.group))];
    $('#ind-list').innerHTML = groups.map(g => {
      const rows = INDICATORS.filter(d => d.group === g && d.label.toLowerCase().includes(q));
      return rows.length ? `<div class="grp">${g}</div>` + rows.map(d =>
        `<div class="item" data-k="${d.key}"><span class="chk">${on.includes(d.key) ? '✓' : ''}</span>${d.label}${g === 'PRO' ? ' <span class="pro">PRO</span>' : ''}</div>`).join('') : '';
    }).join('');
    $('#ind-list').querySelectorAll('.item').forEach(el => el.onclick = () => { activePane().toggleInd(el.dataset.k); renderIndicators(); });
  }

  // ---------- shortcuts ----------
  function onKey(e) {
    if (document.querySelector('dialog[open]')) return;
    if (e.target.closest('input, textarea, select')) return;
    const p = activePane(), alt = e.altKey && !e.ctrlKey && !e.metaKey;
    if (e.key === 'Escape') { Draw.setTool(''); return Draw.deselect(); }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); return e.shiftKey ? Draw.redo() : Draw.undo(); }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); return Draw.redo(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && Draw.sel) { e.preventDefault(); return Draw.remove(); }
    if (alt) {
      const act = e.shiftKey ? { KeyR: () => Draw.setTool('rect') }[e.code] : {
        ...Object.fromEntries(Object.entries(KEYMAP).map(([c, t]) => [c, () => Draw.setTool(t)])),
        KeyI: () => p.toggleScale('invert'), KeyL: () => p.toggleScale('log'), KeyR: () => p.resetView(),
        KeyW: () => toggleWatchlist(),
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
    $('#ind-btn').innerHTML = '<i style="font-family:serif;font-style:italic">ƒx</i> Indicators';
    $('#ind-btn').onclick = openIndicators;
    $('#counts').innerHTML = COUNTS.map(n => `<button class="tb">${n}</button>`).join('');
    $('#counts').querySelectorAll('.tb').forEach(b => b.onclick = () => setCount(+b.textContent));
    $('#help-btn').innerHTML = ICON.keyboard;
    $('#help-btn').onclick = () => $('#help-dlg').showModal();
    $('#wl-btn').innerHTML = ICON.list;
    $('#wl-btn').onclick = toggleWatchlist;
    document.body.classList.toggle('no-wl', !S.wl);

    $('#tools').innerHTML = TOOLS.map(t => t ? `<button class="tb" data-tool="${t[0]}" title="${t[1]}${t[2] ? ` (${t[2]})` : ''}">${ICON[t[0] || 'cursor']}</button>` : '<span class="sep"></span>').join('')
      + `<span class="sep"></span><button class="tb" id="clear-btn" title="Remove all drawings on this symbol">${ICON.trash}</button>`;
    $('#tools').querySelectorAll('.tb[data-tool]').forEach(b => b.onclick = () => Draw.setTool(b.dataset.tool));
    $('#clear-btn').onclick = () => Draw.clear(activePane());
    $('#tools').insertAdjacentHTML('beforeend', `<span class="sep"></span>
      <button class="tb" id="magnet-btn" title="Magnet: snap to open/high/low/close">${ICON.magnet}</button>
      <button class="tb" id="hide-btn" title="Hide all drawings"></button>
      <button class="tb" id="undo-btn" title="Undo (Ctrl/Cmd+Z)">${ICON.undo}</button>`);
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
    document.addEventListener('keydown', onKey);
    Watch.build();
  }

  return { init, syncHeader, syncTools, syncDrawToolbar, openSymbolSearch, ICON };
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
