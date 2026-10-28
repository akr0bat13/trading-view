// Demo trading: virtual accounts live on the server (sim.py, /api/trading); the active chart's symbol is what gets traded.
// The browser only asks: prices, fills and balances are computed server-side.
// Replay: the server owns the simulated time and serves only bars closed by it; this file just asks it to step.
const Trading = (() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const round = v => Math.abs(v) < 0.005 ? 0 : v; // float dust like -1e-13 shows as 0.00, not -0.00
  const money = (v, cur) => v == null ? '—' : (v = round(v), `${v < 0 ? '−' : ''}${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${cur ? ' ' + cur : ''}`);
  const signed = v => v == null ? '' : round(v) > 0 ? 'up' : round(v) < 0 ? 'down' : '';
  const px = v => v == null ? '—' : fmtPrice(v);
  const when = t => t ? new Date(t * 1000).toLocaleString() : '';
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  const pct = v => v == null ? '—' : (v = round(v * 100), `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`);
  const localInput = t => { const d = new Date(t * 1000); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }; // for <input type=datetime-local>
  let st = null, tab = 'positions', side = 'buy', pendingId = null, timer, accounts = [], playing = false;

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
      <button class="fly-item" data-a="replay">${UI.ICON.undo}<span>Replay Trading</span><kbd>history</kbd></button>`;
    const r = $('#trade-btn').getBoundingClientRect();
    m.hidden = false;
    m.style.top = r.bottom + 4 + 'px'; m.style.left = Math.max(4, Math.min(r.left, innerWidth - m.offsetWidth - 4)) + 'px';
    m.querySelector('[data-a=paper]').onclick = () => { m.hidden = true; openPaper(); };
    m.querySelector('[data-a=replay]').onclick = () => { m.hidden = true; openNewReplay(); };
  }

  async function openPaper() {
    let list;
    try { list = accounts = await api('/accounts'); } catch (e) { return toast(e.message); }
    list = list.filter(a => a.mode === 'paper');
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
      accounts = await api('/accounts');
      show(s);
    } catch (e) { $('#acct-err').textContent = e.message; }
  }

  // ---------- replay ----------
  function openNewReplay() {
    const c = activePane().cfg;
    $('#rp-src').innerHTML = ['crypto', 'us', 'ru'].map(k => `<option value="${k}" ${k === c.source ? 'selected' : ''}>${META.sources[k].label}</option>`).join('');
    $('#rp-sym').value = ['crypto', 'us', 'ru'].includes(c.source) ? c.symbol : '';
    $('#rp-tf').value = ['1m', '5m', '15m', '30m', '1h', '1d'].includes(c.tf) ? c.tf : '15m';
    $('#rp-start').value ||= localInput(Date.now() / 1000 - 365 * 86400);
    $('#rp-err').textContent = '';
    $('#rp-dlg').showModal();
    $('#rp-sym').focus();
  }
  async function createReplay() {
    const v = id => $(id).value, btn = $('#rp-create');
    btn.disabled = true; btn.textContent = 'Loading history…';
    try {
      const s = await api('/replays', 'POST', {
        source: v('#rp-src'), symbol: v('#rp-sym').trim(), tf: v('#rp-tf'), start: Math.floor(new Date(v('#rp-start')) / 1000),
        initial: +v('#rp-initial'), fee_bps: +v('#rp-fee'), slippage_bps: +v('#rp-slip'),
      });
      $('#rp-dlg').close();
      S.trade = { open: true, acc: s.account.id }; saveConfigs();
      accounts = await api('/accounts');
      await show(s);
      attach(activePane());
    } catch (e) { $('#rp-err').textContent = e.message; }
    finally { btn.disabled = false; btn.textContent = 'Start replay'; }
  }
  const replayPane = () => st?.replay && panes.find(p => p.cfg.replay === st.account.id);
  // show the session on a chart: that chart leaves live data and only gets bars the server has released
  function attach(pane) {
    const r = st.replay;
    panes.forEach(p => { if (p !== pane && p.cfg.replay === st.account.id) { delete p.cfg.replay; p.load(); } }); // one chart per session
    pane.cfg.replay = st.account.id;
    pane.cfg.source = r.source; pane.cfg.symbol = r.symbol;
    if (!['1m', '5m', '15m', '30m', '1h', '1d'].includes(pane.cfg.tf) || META.timeframes.indexOf(pane.cfg.tf) < META.timeframes.indexOf(r.tf)) pane.cfg.tf = r.tf;
    pane.load();
  }
  function detach(pane) {
    pause();
    delete pane.cfg.replay;
    saveConfigs();
    toast('Replay paused and left on the server. Reopen it from Trading → the account list, then "Show on chart".');
  }
  const ended = () => st?.account.status === 'ended';
  function pause() { playing = false; syncReplay(); }
  function play() {
    if (playing || !st?.replay || ended()) return;
    if (!replayPane()) attach(activePane());
    playing = true; syncReplay(); tick();
  }
  async function tick() {
    if (!playing) return;
    await stepBars(1);
    if (playing) setTimeout(tick, 1000 / (st.replay?.speed || 1)); // 1× = one bar per second
  }
  async function stepBars(n) {
    const pane = replayPane(), id = st.account.id;
    try {
      const s = await api(`/replays/${id}/step`, 'POST', { n, tf: pane?.cfg.tf || st.replay.tf });
      if (st.account.id !== id) return;
      if (pane) s.bars.forEach(b => pane.onBar(b));
      if (!s.stepped) { pause(); toast('End of the loaded history: end the session or go back in time.'); }
      show(s);
    } catch (e) { pause(); toast(e.message); }
  }
  async function seek() {
    const t = Math.floor(new Date($('#rp-seek').value) / 1000);
    if (!t) return;
    pause();
    if (await act(`/replays/${st.account.id}/seek`, 'POST', { time: t })) replayPane()?.load();
  }
  function syncReplay() {
    const r = st?.replay, box = $('#tr-replay');
    box.hidden = !r;
    if (!r) return;
    $('#rp-play').textContent = playing ? '⏸ Pause' : '▶ Play';
    $('#rp-play').classList.toggle('on', playing);
    document.querySelectorAll('#rp-speed .tb').forEach(b => b.classList.toggle('on', +b.dataset.v === r.speed));
    $('#rp-time').textContent = new Date(r.cursor * 1000).toLocaleString();
    $('#rp-sym-l').textContent = `${r.symbol} · ${r.tf} bars`;
    const pane = replayPane();
    $('#rp-attach').hidden = !!pane;
    $('#rp-end').hidden = ended();
    ['#rp-play', '#rp-step', '#rp-go', '#rp-seek'].forEach(id => $(id).disabled = ended());
    if (pane) pane.el.querySelector('.title .meta').textContent = `${pane.cfg.tf} · REPLAY ${r.speed}× · ${new Date(r.cursor * 1000).toLocaleString()}`;
  }
  // Space plays / pauses while a replay is on screen; ui.js already ignores it inside inputs and dialogs
  function onSpace() {
    if (!st?.replay || ended() || $('#trade').hidden) return false;
    playing ? pause() : play();
    return true;
  }

  // ---------- end, reset, report ----------
  function ask(title, text, ok) {
    const d = $('#confirm-dlg');
    $('#cf-title').textContent = title; $('#cf-text').textContent = text; $('#cf-ok').textContent = ok;
    d.returnValue = ''; d.showModal();
    return new Promise(res => { d.onclose = () => res(d.returnValue === 'ok'); });
  }
  async function endSession() {
    pause();
    if (!await ask('End session?', `"${st.account.name}" stops trading: open orders are cancelled and open positions stay valued at the last price. The report stays available, and Reset starts the session over.`, 'End session')) return;
    if (await act(`/replays/${st.account.id}/end`, 'POST')) openReport();
  }
  async function reset() {
    const a = st.account;
    pause();
    if (!await ask('Reset account?', `"${a.name}" goes back to ${money(a.initial, a.currency)}: its orders, trades, positions and balance history are deleted${st.replay ? ' and the replay returns to its start' : ''}. Other accounts and sessions are not affected. This cannot be undone.`, 'Reset')) return;
    if (await act(`/accounts/${a.id}/reset`, 'POST', { confirm: true })) replayPane()?.load();
  }
  function curve(pts, base) {
    if (pts.length < 2) return '';
    const ys = pts.map(p => p[1]).concat(base), lo = Math.min(...ys), hi = Math.max(...ys), x0 = pts[0][0], x1 = pts.at(-1)[0];
    const X = t => ((t - x0) / (x1 - x0 || 1) * 600).toFixed(1), Y = v => (132 - (v - lo) / (hi - lo || 1) * 124).toFixed(1);
    return `<svg class="rep-curve" viewBox="0 0 600 140" preserveAspectRatio="none">
      <line x1="0" x2="600" y1="${Y(base)}" y2="${Y(base)}" stroke="#787b86" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>
      <polyline fill="none" stroke="#2962ff" stroke-width="2" vector-effect="non-scaling-stroke" points="${pts.map(p => X(p[0]) + ',' + Y(p[1])).join(' ')}"/></svg>`;
  }
  async function openReport() {
    let r;
    try { r = await api(`/accounts/${st.account.id}/report`); } catch (e) { return toast(e.message); }
    const cur = r.currency, b = r.buy_and_hold, sym = k => esc(k.split(':')[1]);
    const cell = (k, v, cls = '', sub = '') => `<span><i>${k}</i><b class="${cls}">${v}</b>${sub ? `<small>${sub}</small>` : ''}</span>`;
    $('#rep-title').textContent = `${st.account.name}${r.status === 'ended' ? ' · ended' : ''}`;
    $('#rep-body').innerHTML = `<div class="rep-warn">Virtual money, ${st.replay ? 'historical' : 'live'} prices and a simplified fill model (${when(r.start)} – ${when(r.end)}). These results do not guarantee future profit.</div>
      <div class="rep-grid">${[
        cell('Initial capital', money(r.initial, cur)), cell('Final equity', money(r.equity, cur)),
        cell('Return', money(r.pnl), signed(r.pnl), pct(r.return_pct)),
        cell('Realized PnL', money(r.realized), signed(r.realized), 'before fees'), cell('Unrealized PnL', money(r.unrealized), signed(r.unrealized)),
        cell('Fees', money(r.fees)), cell('Trades', r.trades, '', r.open_trades ? `+ ${r.open_trades} still open` : 'closed'),
        cell('Win rate', pct(r.win_rate)), cell('Avg win / avg loss', `${money(r.avg_win)} / ${money(r.avg_loss)}`),
        cell('Profit factor', r.profit_factor != null ? r.profit_factor.toFixed(2) : r.avg_win != null ? '∞' : '—'),
        cell('Max drawdown', money(-r.max_drawdown), signed(-r.max_drawdown), pct(-r.max_drawdown_pct)),
        cell('Time in market', pct(r.time_in_market)),
        b ? cell('Buy & hold', money(b.pnl), signed(b.pnl), `${pct(b.return_pct)} without fees`) : '',
      ].join('')}</div>
      <div class="rep-h">${st.replay ? 'Equity, marked to each bar' : 'Balance after each fill'}</div>${curve(r.curve, r.initial) || '<div class="tr-empty">No trades yet</div>'}
      <div class="rep-h">Trades (net of fees)</div>${r.trade_list.length ? `<div class="tbl-wrap"><table>
        <tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Exit</th><th>Opened</th><th>Closed</th><th>Fees</th><th>PnL</th></tr>
        ${r.trade_list.map(t => `<tr><td><b>${sym(t.symbol)}</b></td><td class="${t.side === 'long' ? 'up' : 'down'}">${t.side === 'long' ? 'Long' : 'Short'}</td><td>${+t.qty.toPrecision(8)}</td>
          <td>${px(t.entry)}</td><td>${px(t.exit)}</td><td>${when(t.opened)}</td><td>${when(t.closed)}</td><td>${money(t.fees)}</td><td class="${signed(t.pnl)}">${money(t.pnl)}</td></tr>`).join('')}
      </table></div>` : '<div class="tr-empty">No closed trades</div>'}`;
    $('#rep-dlg').showModal();
  }

  // ---------- panel ----------
  async function load() {
    if (!S.trade?.open) return;
    try { show(await api('/accounts/' + S.trade.acc)); }
    catch (e) { toast(e.message); if (/not found/.test(e.message)) close(); }
  }
  function close() { pause(); S.trade = { ...S.trade, open: false }; saveConfigs(); $('#trade').hidden = true; clearInterval(timer); panes.forEach(p => p.applyTrade()); }
  // the state a chart should draw: the open account, on live charts for paper and on its own chart for replay
  const shownOn = pane => st && !$('#trade').hidden && (st.replay ? pane.cfg.replay === st.account.id : !pane.cfg.replay) ? st : null;

  async function show(s) {
    if (st && st.account.id !== s.account.id) pause();
    st = s;
    const panel = $('#trade');
    if (panel.hidden) {
      panel.hidden = false;
      clearInterval(timer);
      timer = setInterval(() => !document.hidden && !st?.replay && load(), 10000); // paper: limit orders and SL/TP fill on the server as bars close
    }
    const a = s.account, m = s.summary, cur = a.currency;
    if (!accounts.some(x => x.id === a.id)) accounts = await api('/accounts').catch(() => [a]);
    $('#tr-acc').innerHTML = accounts.map(x => `<option value="${x.id}" ${x.id === a.id ? 'selected' : ''}>${x.mode === 'replay' ? '⟲ ' : ''}${esc(x.name)} · ${x.currency}</option>`).join('');
    $('#trade').classList.toggle('ended', ended());
    syncReplay();
    $('#tr-stats').innerHTML = [['Balance', m.balance], ['Equity', m.equity], ['Free', m.free], ['Realized', m.realized, 1], ['Unrealized', m.unrealized, 1], ['Fees', m.fees]]
      .map(([k, v, sg]) => `<span><i>${k}</i><b class="${sg ? signed(v) : ''}">${money(v)}</b></span>`).join('') + `<span><i>Currency</i><b>${esc(cur)}</b></span>`;
    const errs = Object.entries(s.errors || {});
    $('#tr-warn').textContent = errs.length ? `No market data for ${errs.map(e => e[0]).join(', ')}: nothing filled for it until data returns.` : '';
    syncSymbol();
    renderTable();
    panes.forEach(p => p.applyTrade());
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

  // the order form trades the active chart's symbol, or the replay's instrument
  const target = () => st?.replay || activePane()?.cfg;
  function syncSymbol() {
    if (!st || $('#trade').hidden) return;
    const c = target();
    if (!c) return;
    $('#tr-sym').textContent = c.symbol;
    $('#tr-src').textContent = META.sources[c.source].label;
    const limit = $('#tr-type').value === 'limit';
    $('#tr-price-f').hidden = !limit;
    const unit = $('#tr-unit').value || 'qty';
    $('#tr-unit').innerHTML = `<option value="qty">${esc(c.symbol)}</option><option value="cash">${esc(st.account.currency)}</option>`;
    $('#tr-unit').value = unit;
    document.querySelectorAll('#tr-side .tb').forEach(b => b.classList.toggle('on', b.dataset.s === side));
    $('#tr-submit').textContent = `${side === 'buy' ? 'Buy' : 'Sell'} ${c.symbol}`;
    $('#tr-submit').className = 'btn primary ' + side;
    $('#tr-note').textContent = ended() ? 'This session has ended: see its Report, or Reset to trade again.' : st.replay ? 'Market orders fill at the next bar\'s open ± slippage; limits only on later bars.'
      : 'Market orders fill at the server\'s last price ± slippage; stock quotes can be delayed.';
    if (unit === 'cash' && !ended()) $('#tr-note').textContent += ` The ${st.account.currency} amount becomes a quantity at the ${limit ? 'limit' : 'current'} price; the fee comes on top.`;
  }

  async function submit(e) {
    e.preventDefault();
    const c = target(), type = $('#tr-type').value, btn = $('#tr-submit');
    const sent = pendingId ||= newId(); // kept until the server answers, so a retry after a network error can't trade twice
    btn.disabled = true;
    const ok = await act(`/accounts/${st.account.id}/orders`, 'POST', {
      client_order_id: sent, source: c.source, symbol: c.symbol, side, type,
      [$('#tr-unit').value === 'cash' ? 'notional' : 'qty']: +$('#tr-qty').value, ...(type === 'limit' ? { price: +$('#tr-price').value } : {}),
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
    $('#rp-create').onclick = createReplay;
    $('#rp-dlg').addEventListener('keydown', e => e.key === 'Enter' && e.target.tagName === 'INPUT' && createReplay());
    $('#rp-play').onclick = () => playing ? pause() : play();
    $('#rp-step').onclick = () => { pause(); if (!replayPane()) attach(activePane()); stepBars(1); };
    $('#rp-speed').onclick = e => { const b = e.target.closest('[data-v]'); if (b) act(`/replays/${st.account.id}`, 'PUT', { speed: +b.dataset.v }); };
    $('#rp-go').onclick = seek;
    $('#rp-attach').onclick = () => attach(activePane());
    $('#rp-end').onclick = endSession;
    $('#tr-report').onclick = openReport;
    $('#tr-reset').onclick = reset;
    $('#cf-ok').onclick = () => $('#confirm-dlg').close('ok');
    $('#cf-cancel').onclick = () => $('#confirm-dlg').close();
    if (S.trade?.open) load();
  }

  return { init, syncSymbol, detach, onSpace, shownOn };
})();
