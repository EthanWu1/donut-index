const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'donutdex-history-'));
const TMP = path.join(TMP_DIR, 'history.sqlite');
process.env.DONUT_DB_PATH = TMP;

function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP + suffix); } catch {}
  }
  try { fs.rmdirSync(TMP_DIR); } catch {}
}
cleanup();
test.after(cleanup);

const db = require('../lib/db');
const auction = require('../jobs/auction');
const history = require('../commands/history');

test('/history renders an auction price chart attachment', async () => {
  const now = Date.now();
  db.recordAuctionPricePoint({ key: 'stone', name: 'Stone', lowestStackPrice: 640 }, now - 3600_000);
  db.recordAuctionPricePoint({ key: 'stone', name: 'Stone', lowestStackPrice: 512 }, now);

  const calls = [];
  const interaction = {
    options: { getString: () => 'stone' },
    async deferReply() { calls.push(['deferReply']); },
    async editReply(payload) { calls.push(['editReply', payload]); },
  };

  await history.execute(interaction);

  assert.strictEqual(calls[0][0], 'deferReply');
  const payload = calls[1][1];
  assert.strictEqual(payload.files.length, 1);
  assert.match(payload.embeds[0].data.description, /Stone/);
  assert.strictEqual(payload.embeds[0].data.image.url, 'attachment://history.png');
});

test('/history autocomplete suggests history and current auction items', async () => {
  db.recordAuctionPricePoint({ key: 'stone', name: 'Stone', lowestStackPrice: 640 }, Date.now());
  const original = auction.getAuctionIndex;
  auction.getAuctionIndex = () => ({
    listings: [{ name: 'Diamond Sword', key: 'diamond_sword', stackPrice: 3200 }],
    transactions: [{ name: 'Golden Apple', key: 'golden_apple' }],
    updatedAt: Date.now(),
  });
  try {
    const calls = [];
    await history.autocomplete({
      options: { getFocused: () => 's' },
      async respond(payload) { calls.push(payload); },
    });
    const names = calls[0].map((x) => x.name);
    assert.ok(names.includes('Stone'));
    assert.ok(names.includes('Diamond Sword'));
  } finally {
    auction.getAuctionIndex = original;
  }
});

test('/history renders from the best current auction listing when no history exists', async () => {
  const original = auction.getAuctionIndex;
  auction.getAuctionIndex = () => ({
    listings: [
      { name: 'Beacon', key: 'beacon', amount: 1, price: 5000, stackPrice: 320000 },
      { name: 'Beacon', key: 'beacon', amount: 1, price: 4000, stackPrice: 256000 },
    ],
    transactions: [],
    updatedAt: Date.now(),
  });
  try {
    const calls = [];
    const interaction = {
      options: { getString: () => 'beacon' },
      async deferReply() { calls.push(['deferReply']); },
      async editReply(payload) { calls.push(['editReply', payload]); },
    };

    await history.execute(interaction);

    const payload = calls[1][1];
    assert.strictEqual(payload.files.length, 1);
    assert.match(payload.embeds[0].data.description, /Beacon/);
    assert.match(payload.embeds[0].data.footer.text, /current AH data/i);
  } finally {
    auction.getAuctionIndex = original;
  }
});
