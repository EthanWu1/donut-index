const config = require('../config');

class KeyPool {
  constructor(keys, perMin) {
    this.slots = keys.map((key) => ({ key, hits: [], cooldownUntil: 0 }));
    this.perMin = perMin;
    this.idx = 0;
  }

  next() {
    if (this.slots.length === 0) return null;
    const now = Date.now();
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[(this.idx + i) % this.slots.length];
      slot.hits = slot.hits.filter((t) => now - t < 60_000);
      if (now < slot.cooldownUntil) continue;
      if (slot.hits.length >= this.perMin) continue;
      this.idx = (this.idx + i + 1) % this.slots.length;
      slot.hits.push(now);
      return slot;
    }
    return null;
  }

  cooldown(slot) {
    slot.cooldownUntil = Date.now() + 60_000;
  }
}

const _store = new Map();
const _cache = {
  get(key) {
    const e = _store.get(key);
    if (!e) return undefined;
    if (Date.now() > e.expires) { _store.delete(key); return undefined; }
    return e.value;
  },
  set(key, value, ttl) {
    _store.set(key, { value, expires: Date.now() + ttl });
  },
};

const pool = new KeyPool(config.apiKeys, config.ratePerKeyPerMin);

class ApiError extends Error {}
class NotFoundError extends ApiError {}
class RateLimitedError extends ApiError {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rawRequest(path) {
  let lastErr = new ApiError('No DonutSMP API keys configured');
  for (let attempt = 0; attempt < config.apiKeys.length * 2 + 1; attempt++) {
    const slot = pool.next();
    if (!slot) {
      if (config.apiKeys.length === 0) throw lastErr;
      lastErr = new RateLimitedError('All API keys are rate-limited right now');
      await sleep(1500);
      continue;
    }
    let res;
    try {
      res = await fetch(config.apiBaseUrl + path, {
        headers: { Authorization: slot.key },
      });
    } catch (e) {
      lastErr = new ApiError(`Network error: ${e.message}`);
      continue;
    }
    if (res.status === 429) { pool.cooldown(slot); lastErr = new RateLimitedError('Rate limited'); continue; }
    if (res.status === 404) throw new NotFoundError('Player or resource not found');
    const text = await res.text();
    if (!res.ok) { lastErr = new ApiError(`HTTP ${res.status}: ${text.slice(0, 120)}`); continue; }
    let json;
    try { json = JSON.parse(text); }
    catch { throw new ApiError(`Non-JSON response: ${text.slice(0, 120)}`); }
    return json.result !== undefined ? json.result : json;
  }
  throw lastErr;
}

async function request(path, ttl) {
  if (ttl) {
    const hit = _cache.get(path);
    if (hit !== undefined) return hit;
  }
  const result = await rawRequest(path);
  if (ttl) _cache.set(path, result, ttl);
  return result;
}

// Picks the first defined candidate field; raw stat field names are confirmed
// against live data in Step 3 of this task.
function pick(obj, candidates) {
  for (const c of candidates) {
    if (obj && obj[c] !== undefined && obj[c] !== null) return Number(obj[c]) || 0;
  }
  return 0;
}

function normalizeStats(raw) {
  return {
    money: pick(raw, ['money', 'balance']),
    shards: pick(raw, ['shards', 'shard']),
    kills: pick(raw, ['kills', 'kill']),
    deaths: pick(raw, ['deaths', 'death']),
    playtime: pick(raw, ['playtime', 'playtimeMinutes', 'time']),
    placed: pick(raw, ['placed_blocks', 'placedBlocks', 'blocks_placed']),
    broken: pick(raw, ['broken_blocks', 'brokenBlocks', 'blocks_broken']),
    mobs: pick(raw, ['mobs_killed', 'mobsKilled', 'mobkills']),
    spent: pick(raw, ['money_spent_on_shop', 'shop_spent', 'moneySpent', 'spent']),
    made: pick(raw, ['money_made_from_sell', 'sell_made', 'moneyMade', 'made']),
  };
}

async function getStats(user) {
  const raw = await request(`/stats/${encodeURIComponent(user)}`, config.cacheTtl.stats);
  return { raw, stats: normalizeStats(raw) };
}
// Uncached balance read — verification needs the live number, not a 60s cache.
async function getBalance(user) {
  const raw = await request(`/stats/${encodeURIComponent(user)}`, 0);
  return normalizeStats(raw).money;
}
const getLookup = (user) =>
  request(`/lookup/${encodeURIComponent(user)}`, config.cacheTtl.lookup);
const getLeaderboard = (type, page) =>
  request(`/leaderboards/${encodeURIComponent(type)}/${page}`, config.cacheTtl.leaderboard);
const getAuctionList = (page) =>
  request(`/auction/list/${page}`, config.cacheTtl.auction);
const getAuctionTransactions = (page) =>
  request(`/auction/transactions/${page}`, config.cacheTtl.auction);

module.exports = {
  KeyPool, _cache, pool,
  ApiError, NotFoundError, RateLimitedError,
  request, normalizeStats,
  getStats, getBalance, getLookup, getLeaderboard, getAuctionList, getAuctionTransactions,
};
