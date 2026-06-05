const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const TMP = path.join(__dirname, 'tmp-test.sqlite');
process.env.DONUT_DB_PATH = TMP;

// Remove the test db plus its WAL/SHM sidecars. The snapshots table is
// append-only, so a leftover file from an aborted run would corrupt results.
function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP + suffix); } catch {}
  }
}
cleanup(); // clear any stale db before the lib opens the file
test.after(cleanup);

const db = require('../lib/db');

test('links: set, get, delete', () => {
  db.setLink('disc1', 'PlayerOne');
  assert.strictEqual(db.getLink('disc1'), 'PlayerOne');
  db.setLink('disc1', 'PlayerTwo'); // overwrite
  assert.strictEqual(db.getLink('disc1'), 'PlayerTwo');
  db.deleteLink('disc1');
  assert.strictEqual(db.getLink('disc1'), null);
});

test('tracked players are de-duplicated', () => {
  db.trackPlayer('Alpha');
  db.trackPlayer('Alpha');
  db.trackPlayer('Beta');
  const all = db.allTracked().sort();
  assert.deepStrictEqual(all, ['Alpha', 'Beta']);
});

test('snapshots: add and query by time', () => {
  const base = Date.now();
  const s = (money) => ({ money, shards: 0, kills: 0, deaths: 0, playtime: 0, placed: 0, broken: 0, mobs: 0, spent: 0, made: 0 });
  db.addSnapshot('Gamma', s(100), base - 30 * 3600_000); // 30h ago
  db.addSnapshot('Gamma', s(200), base - 2 * 3600_000);  // 2h ago
  db.addSnapshot('Gamma', s(300), base);                 // now

  assert.strictEqual(db.latestSnapshot('Gamma').money, 300);
  // newest snapshot at least 24h old
  assert.strictEqual(db.snapshotBefore('Gamma', base - 24 * 3600_000).money, 100);
  assert.strictEqual(db.snapshotsSince('Gamma', base - 3 * 3600_000).length, 2);
  assert.strictEqual(db.latestSnapshot('Unknown'), null);
});

test('auction cache returns only useful recent fallback data', () => {
  const now = Date.now();
  db.saveAuctionCache({
    listings: [{ key: 'stone', name: 'Stone', amount: 64, price: 128, seller: 'Builder' }],
    transactions: [],
    updatedAt: now - 60_000,
  });

  const recent = db.getAuctionCache(6 * 3600_000, now);
  assert.strictEqual(recent.listings.length, 1);
  assert.strictEqual(recent.listings[0].name, 'Stone');

  db.saveAuctionCache({
    listings: [{ key: 'dirt', name: 'Dirt', amount: 64, price: 64, seller: 'Old' }],
    transactions: [],
    updatedAt: now - 7 * 3600_000,
  });
  assert.strictEqual(db.getAuctionCache(6 * 3600_000, now), null);
});

test('auction price history records and compacts one-item prices', () => {
  const day = 86400_000;
  const now = Date.now();
  db.recordAuctionPricePoint({ key: 'stone', name: 'Stone', unitPrice: 10 }, now - 40 * day);
  db.recordAuctionPricePoint({ key: 'stone', name: 'Stone', unitPrice: 8 }, now - 40 * day + 3600_000);
  db.recordAuctionPricePoint({ key: 'stone', name: 'Stone', unitPrice: 11 }, now - 2 * day);

  db.compactAuctionHistory(now, 30 * day);

  const history = db.auctionPriceHistory('stone', 0);
  assert.ok(history.some((p) => p.source === 'unit_daily' && p.unitPrice === 8));
  assert.ok(history.some((p) => p.source === 'unit_raw' && p.unitPrice === 11));
  assert.ok(!history.some((p) => p.source === 'unit_raw' && p.unitPrice === 10));
});

test('auction snapshots average one-item prices from the cheapest listings', () => {
  const now = Date.now();
  db.recordAuctionPriceSnapshot([
    { key: 'diamond', name: 'Diamond', amount: 64, price: 6400 },
    { key: 'diamond', name: 'Diamond', amount: 1, price: 120 },
    { key: 'diamond', name: 'Diamond', amount: 1, price: 50000 },
  ], now);

  const rows = db.auctionPriceHistory('diamond', 0);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].unitPrice, 110);
});
