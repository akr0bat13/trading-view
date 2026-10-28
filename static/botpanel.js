// The paper bot's account: totals, cumulative PnL, open position and trades (all computed by /api/bot/report). Click a trade to see it on the chart.
const BotPanel = (() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const num = (v, d = 2) => v == null ? '—' : `${v < 0 ? '−' : ''}${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
  const cls = v => v > 0 ? 'up' : v < 0 ? 'down' : '';
  const r = v => v == null ? '—' : `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(2)}R`;
  const secs = iso => Date.parse(iso) / 1000, when = iso => iso ? new Date(iso).toLocaleString() : '';
  let trades = [], source = 'live';

  function curve(pts) {
    if (pts.length < 2) return '<div class="tr-empty">Not enough closed trades for a curve yet</div>';
    const xs = pts.map(p => secs(p[0])), ys = pts.map(p => p[1]).concat(0), lo = Math.min(...ys), hi = Math.max(...ys);
    const X = t => ((t - xs[0]) / (xs.at(-1) - xs[0] || 1) * 600).toFixed(1), Y = v => (132 - (v - lo) / (hi - lo || 1) * 124).toFixed(1);
    return `<svg class="rep-curve" viewBox="0 0 600 140" preserveAspectRatio="none">
      <line x1="0" x2="600" y1="${Y(0)}" y2="${Y(0)}" stroke="#787b86" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>
      <polyline fill="none" stroke="#2962ff" stroke-width="2" vector-effect="non-scaling-stroke" points="${pts.map((p, i) => X(xs[i]) + ',' + Y(p[1])).join(' ')}"/></svg>`;
  }

  async function open() {
    const dlg = $('#bot-dlg'), body = $('#bot-body');
    const tab = (v, label) => `<button class="btn${source === v ? ' primary' : ''}" data-src="${v}">${label}</button>`, tabs = `<div class="rep-tabs">${tab('live', 'Live')} ${tab('replay', 'Replay')}</div>`;
    body.innerHTML = tabs + '<div class="tr-empty">Loading…</div>';
    if (!dlg.open) dlg.showModal();
    let j;
    try {
      const resp = await fetch('/api/bot/report' + (source === 'replay' ? '?source=replay' : ''));
      j = await resp.json();
      if (!resp.ok) throw new Error(j.error || resp.statusText);
    } catch (e) { body.innerHTML = tabs + `<div class="err">${esc(e.message)}</div>`; return; }
    const k = j.summary, cell = (a, v, c = '', sub = '') => `<span><i>${a}</i><b class="${c}">${v}</b>${sub ? `<small>${sub}</small>` : ''}</span>`;
    trades = j.trades;
    body.innerHTML = `${tabs}
      <div class="rep-warn">${j.meta ? `Replay on past data, not live trading: ${esc(j.meta.strategy)}, ${esc(j.meta.window)}. ${esc(j.meta.costs)}.` : 'Virtual money on a Binance testnet. PnL is net of fees; R is PnL divided by the risk at entry. A few trades say nothing about the strategy: judge after 30–50.'}</div>
      <div class="rep-grid">${[
        cell('Closed trades', k.closed, '', k.open.length ? `+ ${k.open.length} open` : ''),
        cell('Win rate', k.win_rate == null ? '—' : (k.win_rate * 100).toFixed(0) + '%', '', `${k.wins} wins`),
        cell('PnL, USDT', num(k.pnl), cls(k.pnl)), cell('Total R', r(k.total_r), cls(k.total_r)), cell('Average R', r(k.avg_r), cls(k.avg_r)),
        cell('Profit factor', k.profit_factor != null ? k.profit_factor.toFixed(2) : k.wins ? '∞' : '—'),
        cell('Max drawdown', num(-k.max_drawdown), cls(-k.max_drawdown), 'USDT, from peak PnL'),
        cell('Fees, USDT', num(k.fees)), cell('No entry', k.no_entry, '', 'skipped or rejected'),
      ].join('')}</div>
      ${k.open.map(t => `<div class="rep-h">Open position</div><div class="rep-grid">${[
        cell(esc(t.symbol), t.side === 'short' ? 'Short' : 'Long', t.side === 'short' ? 'down' : 'up', `qty ${Number(t.qty)}`),
        cell('Entry', num(+t.entry_price)), cell('Stop', num(+t.stop_price), 'down'), cell('Target', num(+t.target_price), 'up'),
      ].join('')}</div>`).join('')}
      <div class="rep-h">Cumulative PnL, USDT</div>${curve(k.curve)}
      <div class="rep-h">Trades · click one to see it on the chart</div>${trades.length ? `<div class="tbl-wrap"><table>
        <tr><th>Symbol</th><th>Side</th><th>Entry</th><th>Exit</th><th>Opened</th><th>Closed</th><th>Out by</th><th>PnL</th><th>R</th></tr>
        ${trades.map((t, i) => `<tr data-i="${i}"><td><b>${esc(t.symbol)}</b></td><td class="${t.side === 'short' ? 'down' : 'up'}">${t.side === 'short' ? 'Short' : 'Long'}</td>
          <td>${num(+t.entry_price)}</td><td>${t.exit_price == null ? 'open' : num(+t.exit_price)}</td><td>${when(t.opened_at)}</td><td>${when(t.closed_at)}</td>
          <td>${esc(t.exit_reason || '')}</td><td class="${cls(+t.pnl)}">${t.pnl == null ? '' : num(+t.pnl)}</td><td>${t.r_multiple == null ? '' : r(+t.r_multiple)}</td></tr>`).join('')}
      </table></div>` : '<div class="tr-empty">The bot has not entered a trade yet</div>'}`;
  }

  // put the chart on the trade: the active chart switches to the trade's symbol, then shows the days around entry and exit
  async function show(t) {
    const p = activePane(), symbol = t.symbol.replace(/USDT$/, '');
    $('#bot-dlg').close();
    if (p.cfg.source !== 'crypto' || p.cfg.symbol !== symbol || p.cfg.replay) { delete p.cfg.replay; Object.assign(p.cfg, { source: 'crypto', symbol }); await p.load(); }
    const from = secs(t.opened_at), to = t.closed_at ? secs(t.closed_at) : Date.now() / 1000, pad = Math.max(86400, (to - from) / 2);
    try { p.chart.timeScale().setVisibleRange({ from: from - pad, to: to + pad }); } catch { } // older than the loaded history: leave the view
  }

  function init() {
    $('#bot-btn').innerHTML = `${UI.ICON.long}<span>Bot</span>`;
    $('#bot-btn').onclick = open;
    $('#bot-body').onclick = async e => {
      const b = e.target.closest('[data-src]');
      if (b) { source = b.dataset.src; BOT.source = source; await open(); BOT.refresh(); return; }
      const tr = e.target.closest('tr[data-i]'); if (tr) show(trades[tr.dataset.i]);
    };
  }
  return { init };
})();
