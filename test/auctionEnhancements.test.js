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

test('/ah can use API search for enchantment-aware results', async () => {
  const original = api.getAuctionList;
  api.getAuctionList = async (page, opts) => {
    assert.strictEqual(page, 1);
    assert.strictEqual(opts.search, 'fortune');
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
    const payload = await ah.view(1, 'fortune', 'price_asc');
    assert.match(payload.embeds[0].data.description, /Fortune III/);
    assert.match(payload.embeds[0].data.footer.text, /live search/i);
  } finally {
    api.getAuctionList = original;
  }
});
