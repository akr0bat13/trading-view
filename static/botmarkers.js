// Entry and exit arrows of the paper-trading bot (trades come from /api/bot/trades, see app.py).
const BotMarkers = (() => {
  const GREEN = '#089981', RED = '#f23645', BLUE = '#2962ff';
  const secs = iso => Math.floor(Date.parse(iso) / 1000);

  // time of the bar that contains t (the last bar opening at or before t); null if t is before the first bar
  function snap(bars, t) {
    if (!bars.length || t < bars[0].time) return null;
    let lo = 0, hi = bars.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; bars[mid].time <= t ? lo = mid : hi = mid - 1; }
    return bars[lo].time;
  }

  const base = sym => String(sym || '').replace(/USDT$/, ''); // the bot's BTCUSDT is the chart's BTC
  const forSymbol = (trades, symbol) => trades.filter(t => base(t.symbol) === symbol);
  const rText = t => t.r_multiple == null ? '' : ` ${Number(t.r_multiple) >= 0 ? '+' : ''}${Number(t.r_multiple).toFixed(1)}R`;

  function build(trades, bars) {
    const out = [];
    for (const t of trades) {
      if (!t.opened_at) continue; // skipped, rejected or failed: nothing happened on the chart
      const open = snap(bars, secs(t.opened_at));
      const short = t.side === 'short'; // a short enters with a down arrow above the bar and leaves with an up arrow below it
      if (open != null) out.push({
        time: open, position: short ? 'aboveBar' : 'belowBar', shape: short ? 'arrowDown' : 'arrowUp', color: BLUE,
        text: `${t.replay ? 'Replay' : 'Bot'} ${short ? 'SHORT' : 'BUY'} ${Number(t.qty)}`,
      });
      if (t.closed_at) {
        const close = snap(bars, secs(t.closed_at)), pnl = Number(t.pnl);
        if (close != null) out.push({
          time: close, position: short ? 'belowBar' : 'aboveBar', shape: short ? 'arrowUp' : 'arrowDown',
          color: pnl >= 0 ? GREEN : RED,
          text: `${t.exit_reason === 'take_profit' ? 'TP' : t.exit_reason === 'stop_loss' ? 'SL' : 'Exit'} ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}${rText(t)}`,
        });
      }
    }
    return out.sort((a, b) => a.time - b.time);
  }

  // entry, stop and target of the open position as price lines
  function lines(trades) {
    const out = [];
    for (const t of trades) {
      if (t.status !== 'open') continue;
      const short = t.side === 'short';
      out.push({ price: Number(t.entry_price), color: BLUE, lineStyle: 0, title: `Bot ${short ? 'Short' : 'Long'} ${Number(t.qty)}` });
      if (t.stop_price != null) out.push({ price: Number(t.stop_price), color: RED, lineStyle: 2, title: 'Bot SL' });
      if (t.target_price != null) out.push({ price: Number(t.target_price), color: GREEN, lineStyle: 2, title: 'Bot TP' });
    }
    return out;
  }

  return { build, snap, forSymbol, lines };
})();

if (typeof module !== 'undefined') module.exports = BotMarkers;
