const api = require('./../lib/api');
const config = require('./../config');

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

function normalizeListing(it) {
  const item = it.item || {};
  const dn = typeof item.display_name === 'string'
    ? item.display_name.replace(/§./g, '').trim() : '';
  const rawName = dn || item.id || readName(it.item) || 'Unknown item';
  const amount = Number(item.count ?? it.count ?? it.amount ?? 1) || 1;
  const price = Number(it.price ?? it.cost ?? 0) || 0;
  const seller = (it.seller && it.seller.name) || readName(it.seller) || 'unknown';
  return { name: prettyName(rawName), key: itemKey(item), amount, price, seller: String(seller) };
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

function getAuctionIndex() {
  return { listings, transactions, updatedAt, building };
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
    const live = [];
    for (let p = 1; p <= config.ahMaxPages; p++) {
      let raw;
      try {
        raw = await api.getAuctionList(p);
      } catch (e) {
        console.warn(`[auction] list page ${p}: ${e.message}`);
        break;
      }
      const list = extractList(raw);
      if (!Array.isArray(list) || list.length === 0) break;
      for (const it of list) live.push(normalizeListing(it));
      await sleep(300);
    }

    const sold = [];
    for (let p = 1; p <= config.ahTxnPages; p++) {
      let raw;
      try {
        raw = await api.getAuctionTransactions(p);
      } catch (e) {
        console.warn(`[auction] txn page ${p}: ${e.message}`);
        break;
      }
      const list = extractList(raw);
      if (!Array.isArray(list) || list.length === 0) break;
      for (const t of list) sold.push(normalizeTxn(t));
      await sleep(300);
    }

    if (live.length > 0) listings = live;
    if (sold.length > 0) transactions = sold;
    updatedAt = Date.now();
    console.log(`[auction] indexed ${listings.length} listings, ${transactions.length} recent sales`);
  } finally {
    building = false;
  }
}

function startAuctionJob() {
  rebuild().catch((e) => console.error('[auction] initial build failed', e));
  setInterval(() => rebuild().catch((e) => console.error('[auction]', e)), config.ahRefreshMs);
}

module.exports = { startAuctionJob, getAuctionIndex, rebuild };
