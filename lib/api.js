const https = require('node:https');
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

// DonutSMP's /auction/list endpoint is a GET that carries a JSON body
// (search + sort). fetch() forbids a body on GET, so body requests go through
// the http module. Returns { status, text }, matching the fetch path below.
function getWithBody(url, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(bodyObj);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, text: body }));
    });
    req.setTimeout(30_000, () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// One HTTP round-trip, normalised to { status, text }. Plain requests use
// fetch; requests that need a body use getWithBody.
async function transport(url, headers, body) {
  if (body === undefined) {
    const r = await fetch(url, { headers });
    return { status: r.status, text: await r.text() };
  }
  return getWithBody(url, headers, body);
}

async function rawRequest(path, body) {
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
      res = await transport(config.apiBaseUrl + path, { Authorization: slot.key }, body);
    } catch (e) {
      lastErr = new ApiError(`Network error: ${e.message}`);
      continue;
    }
    if (res.status === 429) { pool.cooldown(slot); lastErr = new RateLimitedError('Rate limited'); continue; }
    if (res.status === 404) throw new NotFoundError('Player or resource not found');
    if (res.status < 200 || res.status >= 300) {
      lastErr = new ApiError(`HTTP ${res.status}: ${res.text.slice(0, 120)}`);
      continue;
    }
    let json;
    try { json = JSON.parse(res.text); }
    catch { throw new ApiError(`Non-JSON response: ${res.text.slice(0, 120)}`); }
    return json.result !== undefined ? json.result : json;
  }
  throw lastErr;
}

async function request(path, ttl, body) {
  if (ttl) {
    const hit = _cache.get(path);
    if (hit !== undefined) return hit;
  }
  const result = await rawRequest(path, body);
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
// /auction/list is a GET that requires a JSON search/sort body — without it
// the API replies HTTP 500. Empty search + a fixed sort lists every page.
const getAuctionList = (page) =>
  request(`/auction/list/${page}`, config.cacheTtl.auction, { search: '', sort: 'lowest_price' });
const getAuctionTransactions = (page) =>
  request(`/auction/transactions/${page}`, config.cacheTtl.auction);

module.exports = {
  KeyPool, _cache, pool,
  ApiError, NotFoundError, RateLimitedError,
  request, normalizeStats,
  getStats, getBalance, getLookup, getLeaderboard, getAuctionList, getAuctionTransactions,
};
