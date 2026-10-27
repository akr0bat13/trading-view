// Demo account on the chart: fills as markers at their exact price, position / SL / TP / limit orders as price lines.
// Pure: takes the server's account snapshot (sim.snapshot) and the chart's bars; the chart side lives in app.js.
const TradeMarkers = (() => {
  const { snap } = typeof BotMarkers !== 'undefined' ? BotMarkers : require('./botmarkers.js');
  const GREEN = '#089981', RED = '#f23645', ORANGE = '#ff9800';
  const num = v => +(+v).toPrecision(8); // 0.30000000000000004 -> 0.3
  const pnl = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;
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
      lines.push({ price: p.avg_price, color: long ? GREEN : RED, lineStyle: 0, title: `${long ? 'Long' : 'Short'} ${num(Math.abs(p.qty))}${p.unrealized != null ? ' ' + pnl(p.unrealized) : ''}` });
      if (p.sl != null) lines.push({ price: p.sl, color: RED, lineStyle: 2, title: 'SL' });
      if (p.tp != null) lines.push({ price: p.tp, color: GREEN, lineStyle: 2, title: 'TP' });
    }
    for (const o of st.orders)
      if (o.symbol === key && o.type === 'limit') lines.push({ price: o.price, color: ORANGE, lineStyle: 1, title: `${o.side === 'buy' ? 'Buy' : 'Sell'} limit ${num(o.qty)}` });
    return { markers: markers.sort((a, b) => a.time - b.time), lines };
  }

  return { build };
})();

if (typeof module !== 'undefined') module.exports = TradeMarkers;
