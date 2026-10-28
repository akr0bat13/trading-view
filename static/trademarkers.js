// Demo account on the chart: fills as markers at their exact price, position / SL / TP / limit orders as price lines.
// Pure: takes the server's account snapshot (sim.snapshot) and the chart's bars; the chart side lives in app.js.
const TradeMarkers = (() => {
  const { snap } = typeof BotMarkers !== 'undefined' ? BotMarkers : require('./botmarkers.js');
  const GREEN = '#089981', RED = '#f23645', ORANGE = '#ff9800';
  const num = v => +(+v).toPrecision(8); // 0.30000000000000004 -> 0.3
  // small positions move by cents: show enough decimals for the two significant digits (0.0123, not 0.00)
  const digits = v => Math.min(8, Math.max(2, Math.ceil(-Math.log10(Math.abs(v) || 1)) + 2));
  const amount = v => Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: digits(v) });
  const pnl = v => `${v >= 0 ? '+' : '−'}${amount(v)}`;
  const pnlPct = (v, cost) => cost ? `${pnl(v / cost * 100)}%` : '';
  // " +0.0123 (+0.12%)" for a position: result in the account currency and as a share of its cost
  const posPnl = p => p.unrealized == null ? '' : ` ${pnl(p.unrealized)} (${pnlPct(p.unrealized, Math.abs(p.qty) * p.avg_price)})`;
  const EXIT = { 'stop loss': 'SL', 'take profit': 'TP' };

  // st: snapshot, key: "source:SYMBOL" of the chart
  function build(st, bars, key) {
    const markers = [], lines = [];
    for (const o of st.history) {
      if (o.symbol !== key || o.fill_time == null) continue;
      const time = snap(bars, o.fill_time), buy = o.side === 'buy';
      if (time == null) continue; // filled before the first loaded bar
      const label = EXIT[o.reason] || (buy ? 'Buy' : 'Sell');
      markers.push({
        time, price: o.fill_price, position: buy ? 'atPriceBottom' : 'atPriceTop', shape: buy ? 'arrowUp' : 'arrowDown',
        color: o.realized ? (o.realized > 0 ? GREEN : RED) : buy ? GREEN : RED,
        text: `${label} ${num(o.qty)}${o.realized ? ' ' + pnl(o.realized) : ''}`,
      });
    }
    for (const p of st.positions) {
      if (p.symbol !== key) continue;
      const long = p.qty > 0;
      lines.push({ price: p.avg_price, color: long ? GREEN : RED, lineStyle: 0, title: `${long ? 'Long' : 'Short'} ${num(Math.abs(p.qty))}${posPnl(p)}` });
      if (p.sl != null) lines.push({ price: p.sl, color: RED, lineStyle: 2, title: 'SL' });
      if (p.tp != null) lines.push({ price: p.tp, color: GREEN, lineStyle: 2, title: 'TP' });
    }
    for (const o of st.orders)
      if (o.symbol === key && o.type === 'limit') lines.push({ price: o.price, color: ORANGE, lineStyle: 1, title: `${o.side === 'buy' ? 'Buy' : 'Sell'} limit ${num(o.qty)}` });
    return { markers: markers.sort((a, b) => a.time - b.time), lines };
  }

  return { build, pnl, pnlPct, amount };
})();

if (typeof module !== 'undefined') module.exports = TradeMarkers;
