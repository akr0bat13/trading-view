// "Bot" dialog: results of the paper bot (BotStats) with an equity curve and a trade table; a row opens the trade on a BTC chart.
const BotPanel = (() => {
  const $ = s => document.querySelector(s);
  const money = v => v == null ? '—' : `${v < 0 ? '−' : ''}${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const cls = v => v > 0 ? 'up' : v < 0 ? 'down' : '';
  const when = iso => iso ? new Date(iso).toLocaleString() : '';

  function curve(points) {
    if (points.length < 2) return '<div class="tr-empty">The curve appears after two closed trades</div>';
    const W = 640, H = 120, xs = points.map(p => p.time), ys = [0, ...points.map(p => p.value)];
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const X = t => ((t - x0) / (x1 - x0 || 1)) * W, Y = v => H - 4 - ((v - y0) / (y1 - y0 || 1)) * (H - 8);
    const line = points.map(p => `${X(p.time).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ');
    const last = points[points.length - 1].value;
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none">
      <line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--line)"/>
      <polyline points="${line}" fill="none" stroke="${last >= 0 ? 'var(--up)' : 'var(--down)'}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
  }

  function render() {
    const s = BotStats.summarize(BOT.trades), body = $('#bot-body');
    const tile = (k, v, c = '') => `<div class="bot-tile"><span>${k}</span><b class="${c}">${v}</b></div>`;
    const trades = BOT.trades.filter(t => t.opened_at);
    body.innerHTML = `<div class="bot-tiles">
        ${tile('Closed trades', s.closed)}
        ${tile('Win rate', s.winRate == null ? '—' : (s.winRate * 100).toFixed(0) + '%')}
        ${tile('Total P&L, USDT', money(s.pnl), cls(s.pnl))}
        ${tile('Profit factor', s.profitFactor == null ? '—' : isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞')}
        ${tile('Max drawdown', money(-s.maxDD), s.maxDD ? 'down' : '')}
        ${tile('Avg R', s.avgR == null ? '—' : s.avgR.toFixed(2), cls(s.avgR))}
      </div>
      <div class="bot-curve">${curve(s.equity)}</div>
      <div id="tr-table"><table><thead><tr><th>Side</th><th>Opened</th><th>Entry</th><th>Stop</th><th>Target</th><th>Closed</th><th>Exit</th><th>P&amp;L</th><th>R</th></tr></thead><tbody>
      ${trades.map((t, i) => `<tr data-i="${i}" style="cursor:pointer"><td>${t.side === 'short' ? 'SHORT' : 'LONG'}</td><td>${when(t.opened_at)}</td>
        <td>${money(+t.entry_price)}</td><td>${t.stop_price ? money(+t.stop_price) : '—'}</td><td>${t.target_price ? money(+t.target_price) : '—'}</td>
        <td>${t.closed_at ? when(t.closed_at) : '<i>open</i>'}</td><td>${t.exit_reason || ''}</td>
        <td class="${cls(+t.pnl)}">${t.pnl == null ? '' : money(+t.pnl)}</td><td>${t.r_multiple == null ? '' : (+t.r_multiple).toFixed(2)}</td></tr>`).join('') ||
        '<tr><td colspan="9" class="tr-empty">The bot has no trades yet</td></tr>'}
      </tbody></table></div>`;
    body.querySelector('tbody').onclick = e => {
      const tr = e.target.closest('tr[data-i]');
      if (tr) show(trades[tr.dataset.i]);
    };
  }

  // switch the active chart to BTC (the bot trades BTCUSDT) and frame the trade
  function show(t) {
    const p = activePane();
    if (p.cfg.source !== 'crypto' || p.cfg.symbol !== 'BTC') p.setSymbol('crypto', 'BTC');
    const from = Date.parse(t.opened_at) / 1000, to = t.closed_at ? Date.parse(t.closed_at) / 1000 : Date.now() / 1000;
    const pad = Math.max(to - from, 3600 * 24) * 0.5;
    $('#bot-dlg').close();
    p.showRange?.(from - pad, to + pad);
  }

  async function open() {
    await BOT.refresh();
    render();
    $('#bot-dlg').showModal();
  }

  function init() {
    $('#bot-btn').innerHTML = `${UI.ICON.long}<span>Bot</span>`;
    $('#bot-btn').onclick = open;
  }

  return { init };
})();
