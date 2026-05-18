const test = require('node:test');
const assert = require('node:assert');
const fmt = require('../lib/format');

test('formatNumber abbreviates with K/M/B/T', () => {
  assert.strictEqual(fmt.formatNumber(120), '120');
  assert.strictEqual(fmt.formatNumber(5690), '5.69K');
  assert.strictEqual(fmt.formatNumber(1_760_000), '1.76M');
  assert.strictEqual(fmt.formatNumber(4_790_000_000), '4.79B');
  assert.strictEqual(fmt.formatNumber(2_300_000_000_000), '2.3T');
  assert.strictEqual(fmt.formatNumber(-2_960_000_000), '-2.96B');
  assert.strictEqual(fmt.formatNumber(0), '0');
});

test('formatDuration renders days and hours', () => {
  // 48d 13h expressed in seconds
  assert.strictEqual(fmt.formatDuration((48 * 24 + 13) * 3600), '48d 13h');
  assert.strictEqual(fmt.formatDuration(90 * 3600 + 40 * 60), '3d 18h 40m');
  assert.strictEqual(fmt.formatDuration(0), '0m');
});

test('formatDelta returns text and direction', () => {
  assert.deepStrictEqual(fmt.formatDelta(100, 60), { text: '+40', up: true, down: false });
  assert.deepStrictEqual(fmt.formatDelta(60, 100), { text: '-40', up: false, down: true });
  assert.deepStrictEqual(fmt.formatDelta(50, 50), { text: '0', up: false, down: false });
  assert.strictEqual(fmt.formatDelta(1_760_000, 4_720_000).text, '-2.96M');
});

test('relativeTime describes the past', () => {
  const now = Date.now();
  assert.strictEqual(fmt.relativeTime(now - 5_000, now), 'just now');
  assert.strictEqual(fmt.relativeTime(now - 3 * 3600_000, now), '3 hours ago');
  assert.strictEqual(fmt.relativeTime(now - 40 * 86400_000, now), 'a month ago');
});
