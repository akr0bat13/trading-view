// Run: node tests/indicators.test.js
const assert = require('assert');
const Ind = require('../static/indicators.js');

const bar = (t, o, h, l, c, v = 100) => ({ time: t, open: o, high: h, low: l, close: c, volume: v });
const rising = Array.from({ length: 40 }, (_, i) => bar(i * 60, 100 + i, 101 + i, 99 + i, 100.5 + i));

assert.strictEqual(Ind.rsi(rising).at(-1).value > 99, true, 'RSI of a steady uptrend ~100');
assert.strictEqual(Ind.williamsR(rising).at(-1).value > -20, true, '%R near top in uptrend');
const bb = Ind.bollinger(rising);
assert.ok(bb.upper.at(-1).value > bb.mid.at(-1).value && bb.mid.at(-1).value > bb.lower.at(-1).value);
assert.strictEqual(bb.mid[18].value, undefined, 'no BB before 20 bars');
assert.ok(Ind.macd(rising).macd.at(-1).value > 0, 'MACD positive in uptrend');
assert.strictEqual(Ind.vwap([bar(0, 1, 2, 0, 1, 1), bar(60, 1, 5, 3, 4, 3)]).at(-1).value, (1 * 1 + 4 * 3) / 4);

// gap up between bar0.high=10 and bar2.low=12 -> bullish FVG, filled by bar4
const f = Ind.fvg([bar(0, 9, 10, 8, 9.5), bar(60, 10, 13, 10, 12.5), bar(120, 12.5, 14, 12, 13.5), bar(180, 13, 14, 12.5, 13), bar(240, 13, 13, 9.5, 10)]);
assert.deepStrictEqual(f.map(g => [g.bull, g.bottom, g.top, g.to]), [[true, 10, 12, 240]]);
const fb = Ind.fvg([bar(0, 12, 13, 12, 12.5), bar(60, 12, 12, 9, 9.5), bar(120, 9.5, 10, 8, 8.5)]);
assert.deepStrictEqual(fb.map(g => [g.bull, g.bottom, g.top, g.to]), [[false, 10, 12, undefined]]);

const vp = Ind.volumeProfile([bar(0, 10, 11, 10, 11, 900), bar(60, 11, 20, 19, 19, 100)], 10);
assert.ok(vp.poc < 12, 'POC sits where most volume traded');
assert.ok(vp.val <= vp.poc && vp.poc <= vp.vah);
console.log('indicators: ok');
