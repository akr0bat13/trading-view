// Run: node tests/trademarkers.test.js
const assert = require('assert');
const TM = require('../static/trademarkers.js');

const T = 1700000000, bars = [0, 900, 1800, 2700].map(t => ({ time: T + t }));
const st = {
  history: [ // newest first, as the server sends it
    { symbol: 'crypto:BTC', side: 'sell', qty: 0.3, status: 'filled', reason: 'stop loss', fill_price: 95, fill_time: T + 1900, realized: -1.5 },
    { symbol: 'crypto:ETH', side: 'buy', qty: 1, status: 'filled', fill_price: 10, fill_time: T + 100, realized: 0 },
    { symbol: 'crypto:BTC', side: 'buy', qty: 0.1, status: 'rejected', reason: 'no market price', fill_price: null, fill_time: null },
    { symbol: 'crypto:BTC', side: 'buy', qty: 0.1 + 0.2, status: 'filled', fill_price: 100, fill_time: T + 950, realized: 0 },
  ],
  positions: [{ symbol: 'crypto:BTC', qty: -2, avg_price: 101, unrealized: 4.25, sl: 110, tp: null }],
  orders: [{ symbol: 'crypto:BTC', type: 'limit', side: 'buy', qty: 1, price: 90 }, { symbol: 'crypto:ETH', type: 'limit', side: 'sell', qty: 1, price: 20 }],
};
const { markers, lines } = TM.build(st, bars, 'crypto:BTC');
assert.deepStrictEqual(markers.map(m => [m.time - T, m.price, m.shape, m.position, m.text]), [
  [900, 100, 'arrowUp', 'atPriceBottom', 'Buy 0.3'],
  [1800, 95, 'arrowDown', 'atPriceTop', 'SL 0.3 −1.50'],
], 'filled orders of this symbol only, at their fill price, oldest first');
assert.deepStrictEqual(lines.map(l => [l.price, l.title]), [[101, 'Short 2 +4.25 (+2.10%)'], [110, 'SL'], [90, 'Buy limit 1']]);
assert.strictEqual(TM.build({ ...st, positions: [{ symbol: 'crypto:BTC', qty: 0.0001, avg_price: 81000, unrealized: 0.0123, sl: null, tp: null }] }, bars, 'crypto:BTC').lines[0].title, 'Long 0.0001 +0.0123 (+0.152%)', 'cents are not rounded away on small positions');
assert.deepStrictEqual(TM.build(st, [], 'crypto:BTC').markers, [], 'no bars loaded: no markers');
console.log('trademarkers ok');
