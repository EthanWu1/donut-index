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
