const test = require('node:test');
const assert = require('node:assert');

const {
  chartSummary,
  chartMarkers,
  chartTitle,
  chartSubtitle,
  layoutMarkerLabels,
  rectsOverlap,
  CHART_COLORS,
} = require('../lib/chart');

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

test('chart title can be the latest statistic value with no subtitle', () => {
  const points = [
    { ts: 1, value: 1000 },
    { ts: 2, value: 1250 },
  ];
  const summary = chartSummary(points, { money: true });

  assert.strictEqual(CHART_COLORS.line, '#1abc9c');
  assert.strictEqual(chartTitle(points, { money: true, title: 'latest' }), '$1,250');
  assert.strictEqual(chartSubtitle(summary, { subtitle: null }), '');
});

test('chart marker label layout avoids overlapping numbers', () => {
  const points = [
    { ts: 1, value: 1000 },
    { ts: 2, value: 1010 },
    { ts: 3, value: 1020 },
    { ts: 4, value: 1030 },
    { ts: 5, value: 1040 },
  ];
  const markers = points.map((p, i) => ({
    kind: i === points.length - 1 ? 'latest' : 'change',
    ts: p.ts,
    value: p.value,
    label: `$${p.value}`,
  }));
  const labels = layoutMarkerLabels(markers, points, {
    W: 280,
    H: 160,
    padL: 42,
    padR: 18,
    padT: 34,
    padB: 28,
    measure: (label) => label.length * 7,
  });

  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      assert.ok(!rectsOverlap(labels[i], labels[j], 3));
    }
  }
});
