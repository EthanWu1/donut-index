const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'donutdex-profile-'));
const TMP = path.join(TMP_DIR, 'profile.sqlite');
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
const api = require('../lib/api');
const { renderProfileCard } = require('../lib/profileCard');
const profile = require('../commands/profile');

const stats = {
  money: 1234567,
  shards: 42,
  kills: 100,
  deaths: 25,
  playtime: 7200000,
  placed: 5000,
  broken: 3000,
  mobs: 700,
  spent: 90000,
  made: 150000,
};

function mockInteraction() {
  const calls = [];
  return {
    user: { id: 'discord-user' },
    options: {
      getString: () => null,
      getUser: () => null,
    },
    async deferReply() { calls.push(['deferReply']); },
    async editReply(payload) { calls.push(['editReply', payload]); },
    calls,
  };
}

test('renderProfileCard returns a PNG buffer', () => {
  const png = renderProfileCard('PlayerOne', {
    stats,
    online: true,
    location: 'survival',
    playtimeSec: 7200,
  });

  assert.ok(Buffer.isBuffer(png));
  assert.deepStrictEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length > 10_000);
});

test('/profile uses the caller linked account and replies with a profile image', async () => {
  const originals = {
    getStats: api.getStats,
    getLookup: api.getLookup,
  };
  api.getStats = async (ign) => {
    assert.strictEqual(ign, 'PlayerOne');
    return { stats };
  };
  api.getLookup = async () => ({ location: 'survival' });
  db.setLink('discord-user', 'PlayerOne');

  try {
    const interaction = mockInteraction();
    await profile.execute(interaction);

    assert.strictEqual(interaction.calls[0][0], 'deferReply');
    assert.strictEqual(interaction.calls[1][0], 'editReply');
    const payload = interaction.calls[1][1];
    assert.strictEqual(payload.files.length, 1);
    assert.strictEqual(payload.embeds[0].data.image.url, 'attachment://profile.png');
  } finally {
    api.getStats = originals.getStats;
    api.getLookup = originals.getLookup;
  }
});
