const api = require('./../lib/api');
const config = require('./../config');
const db = require('./../lib/db');

// DonutSMP auction listing shape (verified):
// { seller: { name }, price, time_left, item: { id, count, display_name } }
function readName(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object') {
    return v.name || v.displayName || v.display_name || v.id || v.type || null;
  }
  return null;
}

function prettyName(raw) {
  const s = String(raw)
    .replace(/^minecraft:/i, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return s || 'Unknown item';
}

function itemKey(item) {
  return String((item && item.id) || '').replace(/^minecraft:/i, '').toLowerCase();
}

function titleCase(raw) {
  return String(raw || '')
    .replace(/^minecraft:/i, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function roman(n) {
  const value = Math.max(1, Math.min(20, Number(n) || 1));
  const numerals = [
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let x = value;
  let out = '';
  for (const [v, s] of numerals) {
    while (x >= v) { out += s; x -= v; }
  }
  return out;
}

function normalizeEnchantId(v) {
  return String(v || '')
    .replace(/^minecraft:/i, '')
    .trim()
    .toLowerCase();
}

function readEnchantments(item) {
  const out = [];
  const push = (id, level) => {
    const clean = normalizeEnchantId(id);
    if (!clean) return;
    const lvl = Number(level ?? 1) || 1;
    out.push({ id: clean, name: titleCase(clean), level: lvl });
  };

  for (const key of ['enchantments', 'enchants', 'stored_enchantments']) {
    const value = item && item[key];
    if (Array.isArray(value)) {
      for (const e of value) {
        if (typeof e === 'string') push(e, 1);
        else if (e && typeof e === 'object') push(e.id || e.name || e.key || e.type, e.level || e.lvl);
      }
    } else if (value && typeof value === 'object') {
      for (const [id, level] of Object.entries(value)) push(id, level);
    }
  }

  const seen = new Set();
  return out.filter((e) => {
    const key = `${e.id}:${e.level}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function enchantText(enchantments) {
  return (enchantments || []).map((e) => `${e.name} ${roman(e.level)}`).join(', ');
}

function normalizeListing(it) {
  const item = it.item || {};
  const dn = typeof item.display_name === 'string'
    ? item.display_name.replace(/§./g, '').trim() : '';
  const rawName = dn || item.id || readName(it.item) || 'Unknown item';
  const amount = Number(item.count ?? it.count ?? it.amount ?? 1) || 1;
  const price = Number(it.price ?? it.cost ?? 0) || 0;
  const seller = (it.seller && it.seller.name) || readName(it.seller) || 'unknown';
  const enchantments = readEnchantments(item);
  const enchants = enchantText(enchantments);
  return {
    name: prettyName(rawName),
    key: itemKey(item),
    amount,
    price,
    stackPrice: amount > 0 ? Math.ceil((price / amount) * 64) : price,
    timeLeft: Number(it.time_left) || 0,
    seller: String(seller),
    enchantments,
    enchantText: enchants,
    searchText: `${prettyName(rawName)} ${itemKey(item)} ${enchants}`.toLowerCase(),
  };
}

// A completed sale. Same item/price shape as a listing; `unit` is per-item.
function normalizeTxn(t) {
  const item = t.item || {};
  const amount = Number(item.count ?? t.count ?? 1) || 1;
  const price = Number(t.price ?? t.cost ?? 0) || 0;
  return {
    name: prettyName(item.id || readName(t.item) || 'Unknown item'),
    key: itemKey(item),
    amount,
    price,
    unit: amount > 0 ? price / amount : price,
  };
}

let listings = [];
let transactions = [];
let updatedAt = 0;
let building = false;
let listingsError = null;
let transactionsError = null;
let stale = false;

function getAuctionIndex() {
  return { listings, transactions, updatedAt, building, listingsError, transactionsError, stale };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extractList(raw) {
  if (Array.isArray(raw)) return raw;
  return raw.auctions || raw.listings || raw.transactions || raw.items || raw.result || [];
}

// Walks every auction page (and recent sold pages) into a fresh index.
async function rebuild() {
  if (building) return;
  building = true;
  try {
    let nextTransactionsError = null;
    // Transactions first: only a few pages, and /price depends on it. The
    // listings scan below is hundreds of pages and would otherwise drain the
    // shared API rate-limit budget before the transactions fetch ever runs.
    const sold = [];
    for (let p = 1; p <= config.ahTxnPages; p++) {
      let raw;
      try {
        raw = await api.getAuctionTransactions(p);
      } catch (e) {
        nextTransactionsError = e;
        console.warn(`[auction] txn page ${p}: ${e.message}`);
        break;
      }
      const list = extractList(raw);
      if (!Array.isArray(list) || list.length === 0) break;
      for (const t of list) {
        if (t && typeof t === 'object') sold.push(normalizeTxn(t));
      }
      await sleep(300);
    }

    let nextListingsError = null;
    const live = [];
    for (let p = 1; p <= config.ahMaxPages; p++) {
      let raw;
      try {
        raw = await api.getAuctionList(p);
      } catch (e) {
        nextListingsError = e;
        console.warn(`[auction] list page ${p}: ${e.message}`);
        break;
      }
      const list = extractList(raw);
      if (!Array.isArray(list) || list.length === 0) break;
      // The API occasionally returns null entries — skip them so one bad row
      // cannot throw and abort the entire index build.
      for (const it of list) {
        if (it && typeof it === 'object') live.push(normalizeListing(it));
      }
      await sleep(300);
    }

    transactionsError = nextTransactionsError;
    if (sold.length > 0) transactions = sold;

    listingsError = nextListingsError;
    if (!listingsError && live.length === 0) {
      listingsError = new api.ApiError('Auction API returned no live listings');
    }
    if (!listingsError) {
      listings = live;
      updatedAt = Date.now();
      stale = false;
      db.saveAuctionCache({ listings, transactions, updatedAt });
      db.recordAuctionPriceSnapshot(listings, updatedAt);
      db.compactAuctionHistory(Date.now(), config.ahHistoryRawRetentionMs);
      db.clearExpiredAuctionCache(config.ahFallbackMs);
    } else {
      const fallback = db.getAuctionCache(config.ahFallbackMs);
      if (fallback) {
        listings = fallback.listings;
        if (fallback.transactions.length) transactions = fallback.transactions;
        updatedAt = fallback.updatedAt;
        stale = true;
      }
    }
    console.log(`[auction] indexed ${listings.length} listings, ${transactions.length} recent sales`);
  } finally {
    building = false;
  }
}

function startAuctionJob() {
  rebuild().catch((e) => console.error('[auction] initial build failed', e));
  setInterval(() => rebuild().catch((e) => console.error('[auction]', e)), config.ahRefreshMs);
}

module.exports = {
  startAuctionJob, getAuctionIndex, rebuild, normalizeListing, normalizeTxn, extractList, enchantText,
};
