const test = require('node:test');
const assert = require('node:assert');

const { chartSummary } = require('../lib/chart');

test('chart summary marks min max latest and duration-formatted playtime changes', () => {
  const summary = chartSummary([
    { ts: 1, value: 48 * 3600 },
    { ts: 2, value: 55 * 3600 },
    { ts: 3, value: 50 * 3600 },
  ], { duration: true });

  assert.strictEqual(summary.latestLabel, '2d 2h');
  assert.strictEqual(summary.minLabel, '2d');
  assert.strictEqual(summary.maxLabel, '2d 7h');
  assert.strictEqual(summary.deltaLabel, '+2h');
});
