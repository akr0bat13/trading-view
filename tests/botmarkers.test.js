// Run: node tests/botmarkers.test.js
const assert = require('assert');
const BM = require('../static/botmarkers.js');

const bars = [0, 3600, 7200, 10800].map(t => ({ time: 1700000000 + t }));
const iso = s => new Date((1700000000 + s) * 1000).toISOString();

assert.strictEqual(BM.snap(bars, 1700000000 + 3700), 1700003600, 'a time inside a bar snaps to its open');
assert.strictEqual(BM.snap(bars, 1700000000 - 1), null, 'before the first bar: no marker');
assert.strictEqual(BM.snap(bars, 1700000000 + 99999), 1700010800, 'after the last bar: the last bar');

const trades = [
  { status: 'skipped', opened_at: null },
  { status: 'closed', opened_at: iso(3700), qty: '0.00624000', closed_at: iso(7300), exit_reason: 'take_profit', pnl: '12.5' },
  { status: 'open', opened_at: iso(10900), qty: '0.005', closed_at: null },
  { status: 'closed', opened_at: iso(-5000), qty: '1', closed_at: iso(7300), exit_reason: 'stop_loss', pnl: '-3' },
];
const m = BM.build(trades, bars);
assert.deepStrictEqual(m.map(x => [x.time - 1700000000, x.shape, x.text]), [
  [3600, 'arrowUp', 'Bot BUY 0.00624'],
  [7200, 'arrowDown', 'TP +12.50'],
  [7200, 'arrowDown', 'SL -3.00'],
  [10800, 'arrowUp', 'Bot BUY 0.005'],
]);
assert.strictEqual(m[1].color, '#089981');
assert.strictEqual(m[2].color, '#f23645');

const shorts = BM.build([{ status: 'closed', side: 'short', opened_at: iso(3700), qty: '0.01', closed_at: iso(7300), exit_reason: 'take_profit', pnl: '5' }], bars);
assert.deepStrictEqual(shorts.map(x => [x.shape, x.position, x.text]), [
  ['arrowDown', 'aboveBar', 'Bot SHORT 0.01'],
  ['arrowUp', 'belowBar', 'TP +5.00'],
]);
console.log('botmarkers ok');
