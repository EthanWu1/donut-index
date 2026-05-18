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

function normalizeListing(it) {
  const item = it.item || {};
  const dn = typeof item.display_name === 'string'
    ? item.display_name.replace(/§./g, '').trim() : '';
  const rawName = dn || item.id || readName(it.item) || 'Unknown item';
  const key = String(item.id || '').replace(/^minecraft:/i, '').toLowerCase();
  const amount = Number(item.count ?? it.count ?? it.amount ?? 1) || 1;
  const price = Number(it.price ?? it.cost ?? 0) || 0;
  const seller = (it.seller && it.seller.name) || readName(it.seller) || 'unknown';
  return { name: prettyName(rawName), key, amount, price, seller: String(seller) };
}

let listings = [];
let updatedAt = 0;
let building = false;

function getAuctionIndex() {
  return { listings, updatedAt, building };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Walks every auction page until an empty page, building a fresh index.
async function rebuild() {
  if (building) return;
  building = true;
  const collected = [];
  try {
    for (let p = 1; p <= config.ahMaxPages; p++) {
      let raw;
      try {
        raw = await api.getAuctionList(p);
      } catch (e) {
        console.warn(`[auction] page ${p}: ${e.message}`);
        break;
      }
      const list = Array.isArray(raw)
        ? raw : (raw.auctions || raw.listings || raw.items || raw.result || []);
      if (!Array.isArray(list) || list.length === 0) break;
      for (const it of list) collected.push(normalizeListing(it));
      await sleep(300);
    }
    if (collected.length > 0) {
      listings = collected;
      updatedAt = Date.now();
      console.log(`[auction] indexed ${listings.length} listings`);
    } else {
      console.warn('[auction] rebuild produced 0 listings; keeping previous index');
    }
  } finally {
    building = false;
  }
}

function startAuctionJob() {
  rebuild().catch((e) => console.error('[auction] initial build failed', e));
  setInterval(() => rebuild().catch((e) => console.error('[auction]', e)), config.ahRefreshMs);
}

module.exports = { startAuctionJob, getAuctionIndex, rebuild };
