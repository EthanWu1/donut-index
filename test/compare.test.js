const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'donutdex-compare-'));
const TMP = path.join(TMP_DIR, 'compare.sqlite');
process.env.DONUT_DB_PATH = TMP;

function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP + suffix); } catch {}
  }
  try { fs.rmdirSync(TMP_DIR); } catch {}
}
cleanup();
test.after(cleanup);

const api = require('../lib/api');
const compare = require('../commands/compare');
const { comparisonRows, comparisonEntries } = require('../lib/compareStats');

const statsA = {
  money: 1500,
  shards: 20,
  kills: 50,
  deaths: 10,
  playtime: 7200000,
  placed: 500,
  broken: 200,
  mobs: 300,
  spent: 1000,
  made: 4000,
};
const statsB = {
  money: 1000,
  shards: 25,
  kills: 45,
  deaths: 12,
  playtime: 3600000,
  placed: 700,
  broken: 200,
  mobs: 250,
  spent: 2000,
  made: 3500,
};

function interaction() {
  const calls = [];
  return {
    options: {
      getString(name) {
        if (name === 'first') return 'Alice';
        if (name === 'second') return 'Bob';
        return null;
      },
    },
    async deferReply() { calls.push(['deferReply']); },
    async editReply(payload) { calls.push(['editReply', payload]); },
    calls,
  };
}

test('comparisonRows labels which player is ahead for each stat', () => {
  const rows = comparisonRows('Alice', statsA, 'Bob', statsB, { playtimeUnitSeconds: 0.001 });

  assert.match(rows.find((r) => r.includes('Balance')), /Alice by/);
  assert.match(rows.find((r) => r.includes('Shards')), /Bob by/);
  assert.match(rows.find((r) => r.includes('Blocks Broken')), /Tie/);
});

test('comparisonEntries expose formatted values and winners for scoreboard rendering', () => {
  const entries = comparisonEntries('Alice', statsA, 'Bob', statsB, { playtimeUnitSeconds: 0.001 });
  const balance = entries.find((e) => e.label === 'Balance');
  const deaths = entries.find((e) => e.label === 'Deaths');
  const broken = entries.find((e) => e.label === 'Blocks Broken');

  assert.strictEqual(balance.winner, 'first');
  assert.strictEqual(balance.firstLabel, '$1.5K');
  assert.strictEqual(balance.secondLabel, '$1K');
  assert.strictEqual(deaths.winner, 'first');
  assert.strictEqual(broken.winner, 'tie');
  assert.strictEqual(broken.diffLabel, '0');
});

test('/compare fetches both players and replies with a comparison embed', async () => {
  const original = api.getStats;
  api.getStats = async (ign) => ({ stats: ign === 'Alice' ? statsA : statsB });
  try {
    const i = interaction();
    await compare.execute(i);

    assert.strictEqual(i.calls[0][0], 'deferReply');
    assert.strictEqual(i.calls[1][0], 'editReply');
    const embed = i.calls[1][1].embeds[0].data;
    assert.match(embed.description, /Alice vs Bob/);
    assert.match(embed.description, /Balance/);
    assert.match(embed.description, /Bob by/);
    assert.strictEqual(i.calls[1][1].files.length, 1);
    assert.strictEqual(i.calls[1][1].embeds[0].data.image.url, 'attachment://compare.png');
  } finally {
    api.getStats = original;
  }
});
