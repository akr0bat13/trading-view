// Results of the paper bot from its closed trades (pure functions, no DOM).
const BotStats = (() => {
  const secs = iso => Date.parse(iso) / 1000;

  function summarize(trades) {
    const closed = trades.filter(t => t.status === 'closed' && t.closed_at && t.pnl != null)
      .sort((a, b) => secs(a.closed_at) - secs(b.closed_at));
    let sum = 0, peak = 0, maxDD = 0, gain = 0, loss = 0, wins = 0, rSum = 0, rN = 0;
    const equity = closed.map(t => {
      const pnl = Number(t.pnl);
      sum += pnl; peak = Math.max(peak, sum); maxDD = Math.max(maxDD, peak - sum);
      if (pnl > 0) { wins++; gain += pnl; } else loss -= pnl;
      if (t.r_multiple != null) { rSum += Number(t.r_multiple); rN++; }
      return { time: secs(t.closed_at), value: sum };
    });
    return {
      closed: closed.length, wins, winRate: closed.length ? wins / closed.length : null,
      pnl: sum, profitFactor: loss ? gain / loss : gain ? Infinity : null,
      maxDD, avgR: rN ? rSum / rN : null,
      open: trades.filter(t => t.status === 'open' || t.status === 'opening'),
      equity,
    };
  }

  return { summarize };
})();

if (typeof module !== 'undefined') module.exports = BotStats;
