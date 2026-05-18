const test = require('node:test');
const assert = require('node:assert');
const { KeyPool, _cache } = require('../lib/api');

test('KeyPool rotates round-robin across keys', () => {
  const pool = new KeyPool(['a', 'b', 'c'], 250);
  assert.strictEqual(pool.next().key, 'a');
  assert.strictEqual(pool.next().key, 'b');
  assert.strictEqual(pool.next().key, 'c');
  assert.strictEqual(pool.next().key, 'a');
});

test('KeyPool skips a key at its per-minute cap', () => {
  const pool = new KeyPool(['a', 'b'], 2);
  pool.next(); pool.next(); // a, b
  pool.next(); pool.next(); // a, b — both now at 2 hits
  assert.strictEqual(pool.next(), null); // exhausted
});

test('KeyPool skips a cooled-down key', () => {
  const pool = new KeyPool(['a', 'b'], 250);
  const a = pool.next();
  pool.cooldown(a);
  assert.strictEqual(pool.next().key, 'b');
  assert.strictEqual(pool.next().key, 'b');
});

test('KeyPool with no keys returns null', () => {
  assert.strictEqual(new KeyPool([], 250).next(), null);
});

test('cache stores and expires values', () => {
  _cache.set('k', 42, 1000);
  assert.strictEqual(_cache.get('k'), 42);
  _cache.set('k', 7, -1); // already expired
  assert.strictEqual(_cache.get('k'), undefined);
});
