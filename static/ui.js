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
    erase: svg('<path d="M8 20h12M4.5 15.5l9-9 5 5-8.5 8.5H8z"/><path d="M9 11l5 5"/>'),
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
    ['rect', 'Rectangle', 'Alt+Shift+R'], ['fib', 'Fib retracement', 'Alt+F'], null,
    ['erase', 'Eraser'],
  ];
  const SHORTCUTS = [
    ['Start typing', 'Symbol search'], ['/', 'Indicators'], ['?', 'This list'], ['Esc', 'Cancel drawing / close dialog'],
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
  }

  function syncTools() {
    document.querySelectorAll('#tools .tb[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === Draw.tool));
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
    if (e.key === 'Escape') return Draw.setTool('');
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

  return { init, syncHeader, syncTools, openSymbolSearch, ICON };
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
