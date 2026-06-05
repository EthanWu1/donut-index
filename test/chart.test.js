const test = require('node:test');
const assert = require('node:assert');

const { chartSummary, chartMarkers } = require('../lib/chart');

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

test('chart markers include subtle value labels for latest extrema and major changes', () => {
  const markers = chartMarkers([
    { ts: 1, value: 1000 },
    { ts: 2, value: 1200 },
    { ts: 3, value: 5000 },
    { ts: 4, value: 5200 },
    { ts: 5, value: 1600 },
  ], { money: true });

  assert.ok(markers.length >= 4);
  assert.ok(markers.some((m) => m.kind === 'latest' && m.label === '$1,600'));
  assert.ok(markers.some((m) => m.kind === 'max' && m.label === '$5,200'));
  assert.ok(markers.some((m) => m.kind === 'change' && m.label === '$5,000'));
});
