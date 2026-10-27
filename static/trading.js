// Demo trading: virtual accounts live on the server (sim.py, /api/trading); the active chart's symbol is what gets traded.
// The browser only asks: prices, fills and balances are computed server-side.
const Trading = (() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const round = v => Math.abs(v) < 0.005 ? 0 : v; // float dust like -1e-13 shows as 0.00, not -0.00
  const money = (v, cur) => v == null ? '—' : (v = round(v), `${v < 0 ? '−' : ''}${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${cur ? ' ' + cur : ''}`);
  const signed = v => v == null ? '' : round(v) > 0 ? 'up' : round(v) < 0 ? 'down' : '';
  const px = v => v == null ? '—' : fmtPrice(v);
  const when = t => t ? new Date(t * 1000).toLocaleString() : '';
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  let st = null, tab = 'positions', side = 'buy', pendingId = null, timer;

  async function api(path, method = 'GET', body) {
    const r = await fetch('/api/trading' + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg; t.onclick = () => t.remove();
    $('#toasts').append(t);
    setTimeout(() => t.remove(), 8000);
  }
  // every action returns the account's fresh state; errors become a toast and leave the panel as it was
  async function act(path, method, body) {
    try { show(await api(path, method, body)); return true; } catch (e) { toast(e.message); return false; }
  }

  // ---------- header menu ----------
  function openMenu() {
    const m = $('#trade-menu');
    if (!m.hidden) return (m.hidden = true);
    m.innerHTML = `<button class="fly-item" data-a="paper">${UI.ICON.long}<span>Paper Trading</span></button>
      <button class="fly-item" disabled title="Coming in the next update">${UI.ICON.undo}<span>Replay Trading</span><kbd>soon</kbd></button>`;
    const r = $('#trade-btn').getBoundingClientRect();
    m.hidden = false;
    m.style.top = r.bottom + 4 + 'px'; m.style.left = Math.max(4, Math.min(r.left, innerWidth - m.offsetWidth - 4)) + 'px';
    m.querySelector('[data-a=paper]').onclick = () => { m.hidden = true; openPaper(); };
  }

  async function openPaper() {
    let list;
    try { list = await api('/accounts'); } catch (e) { return toast(e.message); }
    if (!list.length) return openNewAccount();
    S.trade = { open: true, acc: list.some(a => a.id === S.trade?.acc) ? S.trade.acc : list[0].id };
    saveConfigs();
    load();
  }

  function openNewAccount() {
    $('#acct-err').textContent = '';
    $('#acct-dlg').showModal();
    $('#acct-name').focus();
  }
  async function createAccount() {
    const v = id => $(id).value;
    try {
      const s = await api('/accounts', 'POST', { name: v('#acct-name'), currency: v('#acct-cur'), initial: +v('#acct-initial'), fee_bps: +v('#acct-fee'), slippage_bps: +v('#acct-slip') });
      $('#acct-dlg').close();
      S.trade = { open: true, acc: s.account.id }; saveConfigs();
      show(s);
    } catch (e) { $('#acct-err').textContent = e.message; }
  }

  // ---------- panel ----------
  async function load() {
    if (!S.trade?.open) return;
    try { show(await api('/accounts/' + S.trade.acc)); }
    catch (e) { toast(e.message); if (/not found/.test(e.message)) close(); }
  }
  function close() { S.trade = { ...S.trade, open: false }; saveConfigs(); $('#trade').hidden = true; clearInterval(timer); }

  async function show(s) {
    st = s;
    const panel = $('#trade');
    if (panel.hidden) {
      panel.hidden = false;
      clearInterval(timer);
      timer = setInterval(() => !document.hidden && load(), 10000); // limit orders and SL/TP fill on the server as bars close
    }
    const a = s.account, m = s.summary, cur = a.currency, list = await api('/accounts').catch(() => [a]);
    $('#tr-acc').innerHTML = list.map(x => `<option value="${x.id}" ${x.id === a.id ? 'selected' : ''}>${esc(x.name)} · ${x.currency}</option>`).join('');
    $('#tr-stats').innerHTML = [['Balance', m.balance], ['Equity', m.equity], ['Free', m.free], ['Realized', m.realized, 1], ['Unrealized', m.unrealized, 1], ['Fees', m.fees]]
      .map(([k, v, sg]) => `<span><i>${k}</i><b class="${sg ? signed(v) : ''}">${money(v)}</b></span>`).join('') + `<span><i>Currency</i><b>${esc(cur)}</b></span>`;
    const errs = Object.entries(s.errors || {});
    $('#tr-warn').textContent = errs.length ? `No market data for ${errs.map(e => e[0]).join(', ')}: nothing filled for it until data returns.` : '';
    syncSymbol();
    renderTable();
  }

  function renderTable() {
    if (!st) return;
    const cur = st.account.currency, counts = { positions: st.positions.length, orders: st.orders.length };
    $('#tr-tabs').innerHTML = [['positions', 'Positions'], ['orders', 'Orders'], ['history', 'History'], ['ledger', 'Balance']]
      .map(([k, l]) => `<button class="tb ${k === tab ? 'on' : ''}" data-k="${k}">${l}${counts[k] ? ` <span class="n">${counts[k]}</span>` : ''}</button>`).join('');
    const sym = k => esc(k.split(':')[1]), sideCell = (sd, q) => `<span class="${sd === 'buy' ? 'up' : 'down'}">${sd === 'buy' ? 'Buy' : 'Sell'}</span> ${q}`;
    const table = (head, rows, empty) => rows.length ? `<table><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${rows.join('')}</table>` : `<div class="tr-empty">${empty}</div>`;
    $('#tr-table').innerHTML = {
      positions: () => table(['Symbol', 'Side', 'Qty', 'Avg price', 'Last', 'Unrealized PnL', 'Stop loss', 'Take profit', ''],
        st.positions.map(p => `<tr data-k="${esc(p.symbol)}"><td><b>${sym(p.symbol)}</b></td><td class="${p.qty > 0 ? 'up' : 'down'}">${p.qty > 0 ? 'Long' : 'Short'}</td>
          <td>${Math.abs(p.qty)}</td><td>${px(p.avg_price)}</td><td>${px(p.mark)}</td><td class="${signed(p.unrealized)}">${money(p.unrealized, cur)}</td>
          <td><input type="number" step="any" data-f="sl" value="${p.sl ?? ''}" placeholder="—"></td><td><input type="number" step="any" data-f="tp" value="${p.tp ?? ''}" placeholder="—"></td>
          <td class="acts"><button class="btn" data-a="exits">Set SL/TP</button><button class="btn" data-a="close">Close</button></td></tr>`), 'No open positions'),
      orders: () => table(['Placed', 'Symbol', 'Side', 'Type', 'Limit', ''],
        st.orders.map(o => `<tr data-id="${o.id}"><td>${when(o.created_at)}</td><td><b>${sym(o.symbol)}</b></td><td>${sideCell(o.side, o.qty)}</td><td>${o.type}</td><td>${px(o.price)}</td>
          <td class="acts"><button class="btn" data-a="cancel">Cancel</button></td></tr>`), 'No active orders'),
      history: () => table(['Placed', 'Symbol', 'Side', 'Type', 'Status', 'Fill price', 'Fee', 'Realized PnL', 'Filled'],
        st.history.map(o => `<tr><td>${when(o.created_at)}</td><td><b>${sym(o.symbol)}</b></td><td>${sideCell(o.side, o.qty)}</td><td>${o.type}${o.price ? ' ' + px(o.price) : ''}</td>
          <td class="st-${o.status}">${o.status}${o.reason ? ` <span class="why">${esc(o.reason)}</span>` : ''}</td><td>${px(o.fill_price)}</td><td>${o.fee != null ? money(o.fee) : ''}</td>
          <td class="${signed(o.realized)}">${o.realized ? money(o.realized) : ''}</td><td>${when(o.fill_time)}</td></tr>`), 'No orders yet'),
      ledger: () => table(['Time', 'Change', 'Kind', 'Balance after'],
        st.ledger.map(l => `<tr><td>${when(l.time)}</td><td class="${signed(l.delta)}">${money(l.delta)}</td><td>${l.kind}</td><td>${money(l.balance_after, cur)}</td></tr>`), ''),
    }[tab]();
  }

  // the order form trades the active chart's symbol
  function syncSymbol() {
    if (!st || $('#trade').hidden) return;
    const c = activePane()?.cfg;
    if (!c) return;
    $('#tr-sym').textContent = c.symbol;
    $('#tr-src').textContent = META.sources[c.source].label;
    const limit = $('#tr-type').value === 'limit';
    $('#tr-price-f').hidden = !limit;
    document.querySelectorAll('#tr-side .tb').forEach(b => b.classList.toggle('on', b.dataset.s === side));
    $('#tr-submit').textContent = `${side === 'buy' ? 'Buy' : 'Sell'} ${c.symbol}`;
    $('#tr-submit').className = 'btn primary ' + side;
  }

  async function submit(e) {
    e.preventDefault();
    const c = activePane().cfg, type = $('#tr-type').value, btn = $('#tr-submit');
    const sent = pendingId ||= newId(); // kept until the server answers, so a retry after a network error can't trade twice
    btn.disabled = true;
    const ok = await act(`/accounts/${st.account.id}/orders`, 'POST', {
      client_order_id: sent, source: c.source, symbol: c.symbol, side, type,
      qty: +$('#tr-qty').value, ...(type === 'limit' ? { price: +$('#tr-price').value } : {}),
    });
    btn.disabled = false;
    if (ok) {
      pendingId = null;
      const rejected = st.history.find(o => o.client_order_id === sent && o.status === 'rejected');
      if (rejected) toast(`Order rejected: ${rejected.reason}`);
      else tab = st.orders.some(o => o.client_order_id === sent) ? 'orders' : 'positions';
      renderTable();
    }
  }

  async function onTableClick(e) {
    const b = e.target.closest('[data-a]'), row = e.target.closest('tr'), id = st.account.id;
    if (!b) return;
    if (b.dataset.a === 'cancel') return act(`/accounts/${id}/orders/${row.dataset.id}`, 'DELETE');
    if (b.dataset.a === 'close') return act(`/accounts/${id}/close`, 'POST', { client_order_id: newId(), symbol: row.dataset.k });
    if (b.dataset.a === 'exits') {
      const v = f => { const x = row.querySelector(`[data-f=${f}]`).value; return x === '' ? null : +x; };
      return act(`/accounts/${id}/exits`, 'PUT', { symbol: row.dataset.k, sl: v('sl'), tp: v('tp') });
    }
  }

  function init() {
    $('#trade-btn').innerHTML = `${UI.ICON.long}<span>Trading</span>`;
    $('#trade-btn').onclick = e => { e.stopPropagation(); openMenu(); };
    document.addEventListener('click', e => e.target.closest('#trade-menu') || ($('#trade-menu').hidden = true));
    $('#acct-create').onclick = createAccount;
    $('#acct-dlg').addEventListener('keydown', e => e.key === 'Enter' && e.target.tagName === 'INPUT' && createAccount());
    $('#tr-new').onclick = openNewAccount;
    $('#tr-close').onclick = close;
    $('#tr-acc').onchange = () => { S.trade.acc = +$('#tr-acc').value; saveConfigs(); load(); };
    $('#tr-side').onclick = e => { const b = e.target.closest('[data-s]'); if (b) { side = b.dataset.s; pendingId = null; syncSymbol(); } };
    $('#tr-form').oninput = () => { pendingId = null; syncSymbol(); }; // a changed order is a new order
    $('#tr-form').onsubmit = submit;
    $('#tr-tabs').onclick = e => { const b = e.target.closest('[data-k]'); if (b) { tab = b.dataset.k; renderTable(); } };
    $('#tr-table').onclick = onTableClick;
    if (S.trade?.open) load();
  }

  return { init, syncSymbol };
})();
