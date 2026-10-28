// Run: node tests/botstats.test.js
const assert = require('assert');
const BS = require('../static/botstats.js');

const iso = s => new Date((1700000000 + s) * 1000).toISOString();
const s = BS.summarize([
  { status: 'skipped' },
  { status: 'closed', closed_at: iso(300), pnl: '-5', r_multiple: '-1' },
  { status: 'closed', closed_at: iso(100), pnl: '10', r_multiple: '2' },
  { status: 'closed', closed_at: iso(200), pnl: '20', r_multiple: '1' },
  { status: 'open', opened_at: iso(400) },
]);
assert.strictEqual(s.closed, 3);
assert.strictEqual(s.winRate, 2 / 3);
assert.strictEqual(s.pnl, 25);
assert.strictEqual(s.profitFactor, 6);
assert.strictEqual(s.maxDD, 5);
assert.strictEqual(s.avgR, 2 / 3);
assert.deepStrictEqual(s.equity.map(p => p.value), [10, 30, 25], 'equity is the running sum in close order');
assert.strictEqual(s.open.length, 1);

const none = BS.summarize([]);
assert.strictEqual(none.winRate, null);
assert.strictEqual(none.profitFactor, null);
console.log('botstats ok');
