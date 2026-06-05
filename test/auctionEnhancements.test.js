const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'donutdex-auction-enhancements-'));
const TMP = path.join(TMP_DIR, 'auction.sqlite');
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
const auction = require('../jobs/auction');
const ah = require('../commands/ah');

test('normalizeListing preserves enchantments for display and search', () => {
  const listing = auction.normalizeListing({
    seller: { name: 'Seller' },
    price: 1000,
    time_left: 60_000,
    item: {
      id: 'minecraft:diamond_pickaxe',
      count: 1,
      display_name: 'Diamond Pickaxe',
      enchantments: [{ id: 'minecraft:fortune', level: 3 }],
    },
  });

  assert.deepStrictEqual(listing.enchantments, [{ id: 'fortune', name: 'Fortune', level: 3 }]);
  assert.match(listing.searchText, /fortune/i);
});

test('normalizeListing ignores nested non-enchantment item metadata', () => {
  const listing = auction.normalizeListing({
    seller: { name: 'Seller' },
    price: 1000,
    time_left: 60_000,
    item: {
      id: 'minecraft:diamond_chestplate',
      count: 1,
      display_name: 'Diamond Chestplate',
      enchantments: {
        enchantments: [{ id: 'minecraft:protection', level: 4 }],
        trim: { material: 'minecraft:diamond', pattern: 'minecraft:sentry' },
      },
    },
  });

  assert.deepStrictEqual(listing.enchantments, [{ id: 'protection', name: 'Protection', level: 4 }]);
  assert.match(listing.enchantText, /Protection IV/);
  assert.doesNotMatch(listing.enchantText, /Enchantments I/);
  assert.doesNotMatch(listing.enchantText, /Trim I/);
});

test('/ah searches the global cached index before live API search', async () => {
  const originalList = api.getAuctionList;
  const originalTransactions = api.getAuctionTransactions;
  let liveSearchCalls = 0;

  api.getAuctionTransactions = async () => [];
  api.getAuctionList = async (page, opts = {}) => {
    if (opts.search) {
      liveSearchCalls += 1;
      return [];
    }
    if (page > 1) return [];
    return [{
      seller: { name: 'Miner' },
      price: 2048,
      item: {
        id: 'minecraft:diamond_pickaxe',
        count: 1,
        display_name: 'Diamond Pickaxe',
        enchantments: [{ id: 'minecraft:fortune', level: 3 }],
      },
    }];
  };

  try {
    await auction.rebuild();
    const payload = await ah.view(1, 'fortune', 'price_asc');
    assert.match(payload.embeds[0].data.description, /Fortune III/);
    assert.doesNotMatch(payload.embeds[0].data.footer.text, /live search/i);
    assert.strictEqual(liveSearchCalls, 0);
    const components = payload.components.flatMap((row) => row.toJSON().components);
    assert.ok(components.some((c) => c.type === 3 && c.custom_id.startsWith('ah:sort:')));
    assert.ok(components.some((c) => c.type === 2 && c.custom_id.startsWith('ah:page:')));
  } finally {
    api.getAuctionList = originalList;
    api.getAuctionTransactions = originalTransactions;
  }
});

test('/ah autocomplete suggests items from recent auction cache fallback', async () => {
  const db = require('../lib/db');
  db.saveAuctionCache({
    listings: [{
      name: 'Fallbackonly Hoe',
      key: 'fallbackonly_hoe',
      searchText: 'fallbackonly hoe efficiency',
      amount: 1,
      price: 1000,
      seller: 'Cache',
    }],
    transactions: [],
    updatedAt: Date.now(),
  });

  const calls = [];
  await ah.autocomplete({
    options: { getFocused: () => 'fallbackonly' },
    async respond(payload) { calls.push(payload); },
  });

  assert.deepStrictEqual(calls[0], [{ name: 'Fallbackonly Hoe', value: 'Fallbackonly Hoe' }]);
});
