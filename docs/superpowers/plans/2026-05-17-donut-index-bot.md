# Donut Index Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build "Donut Index", a public multi-server Discord bot that surfaces DonutSMP player stats, leaderboards, and auction-house data, with Discord↔IGN linking and stored stat history for 24h deltas.

**Architecture:** discord.js v14 client loads slash commands from `commands/` and events from `events/`. A `lib/api.js` module wraps the DonutSMP REST API with a round-robin API-key pool (rate-limit aware) and a TTL cache. `lib/db.js` (better-sqlite3) stores Discord↔IGN links and periodic stat snapshots; a `jobs/snapshot.js` interval job populates snapshots so 24h deltas and the balance-history chart work. Pure helpers (`format.js`) are unit-tested; Discord glue is manually verified.

**Tech Stack:** Node.js (CommonJS), discord.js ^14.17, better-sqlite3, @napi-rs/canvas, dotenv, node:test.

---

## File Structure

```
donutdex/
  package.json
  .gitignore
  .env.example
  config.js                env + tunable constants
  index.js                 client bootstrap, command/event loader, job start
  deploy-commands.js        registers slash commands (global or guild)
  ecosystem.config.js       PM2 process config
  lib/
    api.js                  KeyPool, TTL cache, DonutSMP request + endpoint helpers
    db.js                   better-sqlite3: links, snapshots, tracked players
    format.js               number/duration/delta/relative-time formatting (pure)
    emojis.js               custom emoji id map
    embeds.js               shared embed builders
    chart.js                balance-history PNG renderer
  commands/
    stats.js  link.js  unlink.js  leaderboard.js  ah.js  worth.js
  events/
    ready.js  interactionCreate.js
  jobs/
    snapshot.js             periodic stat snapshot job
  data/                     sqlite file (gitignored, created at runtime)
  test/
    format.test.js  api.test.js  db.test.js
  README.md
```

All paths below are relative to `donutdex/`.

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `.gitignore`, `.env.example`, `config.js`, `ecosystem.config.js`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "donut-index",
  "version": "1.0.0",
  "type": "commonjs",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "deploy": "node deploy-commands.js",
    "test": "node --test \"test/*.test.js\""
  },
  "dependencies": {
    "@napi-rs/canvas": "^0.1.44",
    "better-sqlite3": "^12.0.0",
    "discord.js": "^14.17.0",
    "dotenv": "^16.4.5"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
.env
data/
.design-checks/
```

- [ ] **Step 3: Create `.env.example`**

```
# Discord — regenerate the token after any plain-text exposure.
BOT_TOKEN=
CLIENT_ID=1467728249936417026
# Leave GUILD_ID blank for production (global commands). Set it to a test
# server id during development for instant command updates.
GUILD_ID=

# DonutSMP — comma-separate multiple keys to raise the rate-limit budget.
DONUTSMP_API_KEYS=
DONUTSMP_BASE_URL=https://api.donutsmp.net/v1
```

- [ ] **Step 4: Create `config.js`**

```js
require('dotenv').config();

function parseKeys() {
  return (process.env.DONUTSMP_API_KEYS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = {
  token: process.env.BOT_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID || null,
  apiKeys: parseKeys(),
  apiBaseUrl: process.env.DONUTSMP_BASE_URL || 'https://api.donutsmp.net/v1',
  // TTL (ms) for the response cache, per endpoint family.
  cacheTtl: { stats: 60_000, lookup: 60_000, leaderboard: 300_000, auction: 60_000 },
  ratePerKeyPerMin: 250,
  snapshotIntervalMs: 3 * 60 * 60 * 1000,
  // Verified in Task 4 against live data; minutes is the working assumption.
  playtimeUnitSeconds: 60,
  embedColor: 0xe89b5a,
  brand: 'Donut Index',
};
```

- [ ] **Step 5: Create `ecosystem.config.js`**

```js
module.exports = {
  apps: [{ name: 'donut-index', script: 'index.js', autorestart: true }],
};
```

- [ ] **Step 6: Install dependencies**

Run: `cd donutdex && npm install`
Expected: `node_modules/` created, no errors. `better-sqlite3` compiles a native binary — on Windows this needs build tools; if it fails, run `npm install --build-from-source` or install the Visual Studio Build Tools.

- [ ] **Step 7: Commit**

```bash
git add donutdex/package.json donutdex/.gitignore donutdex/.env.example donutdex/config.js donutdex/ecosystem.config.js
git commit -m "chore: scaffold Donut Index bot project"
```

---

## Task 2: Formatting helpers (`lib/format.js`)

**Files:**
- Create: `lib/format.js`
- Test: `test/format.test.js`

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test');
const assert = require('node:assert');
const fmt = require('../lib/format');

test('formatNumber abbreviates with K/M/B/T', () => {
  assert.strictEqual(fmt.formatNumber(120), '120');
  assert.strictEqual(fmt.formatNumber(5690), '5.69K');
  assert.strictEqual(fmt.formatNumber(1_760_000), '1.76M');
  assert.strictEqual(fmt.formatNumber(4_790_000_000), '4.79B');
  assert.strictEqual(fmt.formatNumber(2_300_000_000_000), '2.3T');
  assert.strictEqual(fmt.formatNumber(-2_960_000_000), '-2.96B');
  assert.strictEqual(fmt.formatNumber(0), '0');
});

test('formatDuration renders days and hours', () => {
  // 48d 13h expressed in seconds
  assert.strictEqual(fmt.formatDuration((48 * 24 + 13) * 3600), '48d 13h');
  assert.strictEqual(fmt.formatDuration(90 * 3600 + 40 * 60), '3d 18h 40m');
  assert.strictEqual(fmt.formatDuration(0), '0m');
});

test('formatDelta returns text and direction', () => {
  assert.deepStrictEqual(fmt.formatDelta(100, 60), { text: '+40', up: true, down: false });
  assert.deepStrictEqual(fmt.formatDelta(60, 100), { text: '-40', up: false, down: true });
  assert.deepStrictEqual(fmt.formatDelta(50, 50), { text: '0', up: false, down: false });
  assert.strictEqual(fmt.formatDelta(1_760_000, 4_720_000).text, '-2.96M');
});

test('relativeTime describes the past', () => {
  const now = Date.now();
  assert.strictEqual(fmt.relativeTime(now - 5_000, now), 'just now');
  assert.strictEqual(fmt.relativeTime(now - 3 * 3600_000, now), '3 hours ago');
  assert.strictEqual(fmt.relativeTime(now - 40 * 86400_000, now), 'a month ago');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd donutdex && node --test test/format.test.js`
Expected: FAIL — `Cannot find module '../lib/format'`.

- [ ] **Step 3: Write the implementation**

```js
const UNITS = [
  { v: 1e12, s: 'T' },
  { v: 1e9, s: 'B' },
  { v: 1e6, s: 'M' },
  { v: 1e3, s: 'K' },
];

function formatNumber(n) {
  const num = Number(n) || 0;
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);
  for (const u of UNITS) {
    if (abs >= u.v) {
      const scaled = abs / u.v;
      // up to 2 decimals, trailing zeros trimmed
      const str = scaled.toFixed(2).replace(/\.?0+$/, '');
      return sign + str + u.s;
    }
  }
  return sign + String(Math.trunc(abs));
}

function formatDuration(totalSeconds) {
  let s = Math.max(0, Math.trunc(Number(totalSeconds) || 0));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m || parts.length === 0) parts.push(`${m}m`);
  return parts.join(' ');
}

function formatDelta(current, previous) {
  const diff = (Number(current) || 0) - (Number(previous) || 0);
  const up = diff > 0;
  const down = diff < 0;
  const text = (up ? '+' : '') + formatNumber(diff);
  return { text, up, down };
}

function relativeTime(then, now = Date.now()) {
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 30) return 'just now';
  if (sec < 90) return 'a minute ago';
  const min = Math.round(sec / 60);
  if (min < 45) return `${min} minutes ago`;
  const hr = Math.round(sec / 3600);
  if (hr < 2) return 'an hour ago';
  if (hr < 24) return `${hr} hours ago`;
  const day = Math.round(sec / 86400);
  if (day < 2) return 'a day ago';
  if (day < 30) return `${day} days ago`;
  const mon = Math.round(day / 30);
  if (mon < 2) return 'a month ago';
  if (mon < 12) return `${mon} months ago`;
  const yr = Math.round(day / 365);
  return yr < 2 ? 'a year ago' : `${yr} years ago`;
}

module.exports = { formatNumber, formatDuration, formatDelta, relativeTime };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd donutdex && node --test test/format.test.js`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add donutdex/lib/format.js donutdex/test/format.test.js
git commit -m "feat: add formatting helpers"
```

---

## Task 3: API key pool and cache (`lib/api.js` part 1)

**Files:**
- Create: `lib/api.js`
- Test: `test/api.test.js`

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test');
const assert = require('node:assert');
const { KeyPool, _cache } = require('../lib/api');

test('KeyPool rotates round-robin across keys', () => {
  const pool = new KeyPool(['a', 'b', 'c'], 250);
  assert.strictEqual(pool.next().key, 'a');
  assert.strictEqual(pool.next().key, 'b');
  assert.strictEqual(pool.next().key, 'c');
  assert.strictEqual(pool.next().key, 'a');
});

test('KeyPool skips a key at its per-minute cap', () => {
  const pool = new KeyPool(['a', 'b'], 2);
  pool.next(); pool.next(); // a, b
  pool.next(); pool.next(); // a, b — both now at 2 hits
  assert.strictEqual(pool.next(), null); // exhausted
});

test('KeyPool skips a cooled-down key', () => {
  const pool = new KeyPool(['a', 'b'], 250);
  const a = pool.next();
  pool.cooldown(a);
  assert.strictEqual(pool.next().key, 'b');
  assert.strictEqual(pool.next().key, 'b');
});

test('KeyPool with no keys returns null', () => {
  assert.strictEqual(new KeyPool([], 250).next(), null);
});

test('cache stores and expires values', () => {
  _cache.set('k', 42, 1000);
  assert.strictEqual(_cache.get('k'), 42);
  _cache.set('k', 7, -1); // already expired
  assert.strictEqual(_cache.get('k'), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd donutdex && node --test test/api.test.js`
Expected: FAIL — `Cannot find module '../lib/api'`.

- [ ] **Step 3: Write `lib/api.js` (pool + cache only — request logic added in Task 4)**

```js
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

module.exports = { KeyPool, _cache, pool };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd donutdex && node --test test/api.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add donutdex/lib/api.js donutdex/test/api.test.js
git commit -m "feat: add API key pool and TTL cache"
```

---

## Task 4: DonutSMP request layer and endpoint helpers (`lib/api.js` part 2)

**Files:**
- Modify: `lib/api.js`

- [ ] **Step 1: Add request logic, errors, normalizer, and endpoint helpers**

Replace the `module.exports` line at the end of `lib/api.js` with the following block:

```js
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
  getStats, getLookup, getLeaderboard, getAuctionList, getAuctionTransactions,
};
```

- [ ] **Step 2: Run existing API tests to confirm no regression**

Run: `cd donutdex && node --test test/api.test.js`
Expected: PASS — 5 tests still pass (`_cache`, `KeyPool` exports unchanged).

- [ ] **Step 3: Verify live field names (requires a real key in `.env`)**

Create a throwaway script `donutdex/scratch-verify.js`:

```js
const api = require('./lib/api');
(async () => {
  const { raw } = await api.getStats(process.argv[2] || 'ietz');
  console.log('STATS RAW KEYS:', Object.keys(raw));
  console.log(JSON.stringify(raw, null, 2));
  console.log('LOOKUP:', JSON.stringify(await api.getLookup(process.argv[2] || 'ietz'), null, 2));
  console.log('LEADERBOARD money p1:', JSON.stringify(await api.getLeaderboard('money', 1), null, 2).slice(0, 800));
  console.log('AUCTION list p1:', JSON.stringify(await api.getAuctionList(1), null, 2).slice(0, 800));
})();
```

Run: `cd donutdex && node scratch-verify.js ietz`
Expected: prints raw JSON. **Action:** compare the printed `STATS RAW KEYS` to the candidate arrays in `normalizeStats`; if a real key is missing from a candidate list, add it. Inspect the `playtime` value — if it is far too large to be minutes (e.g. matches `(48d13h in ticks)`), set `config.playtimeUnitSeconds` accordingly (ticks → `1/20`; ms → `1/1000`; seconds → `1`; minutes → `60`). Note the leaderboard and auction array shapes for Tasks 13–14. Then delete `scratch-verify.js`.

- [ ] **Step 4: Commit**

```bash
git add donutdex/lib/api.js donutdex/config.js
git commit -m "feat: add DonutSMP request layer and endpoint helpers"
```

---

## Task 5: Database layer (`lib/db.js`)

**Files:**
- Create: `lib/db.js`
- Test: `test/db.test.js`

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const TMP = path.join(__dirname, 'tmp-test.sqlite');
process.env.DONUT_DB_PATH = TMP;

// Remove the test db plus its WAL/SHM sidecars. The snapshots table is
// append-only, so a leftover file from an aborted run would corrupt results.
function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP + suffix); } catch {}
  }
}
cleanup(); // clear any stale db before the lib opens the file
test.after(cleanup);

const db = require('../lib/db');

test('links: set, get, delete', () => {
  db.setLink('disc1', 'PlayerOne');
  assert.strictEqual(db.getLink('disc1'), 'PlayerOne');
  db.setLink('disc1', 'PlayerTwo'); // overwrite
  assert.strictEqual(db.getLink('disc1'), 'PlayerTwo');
  db.deleteLink('disc1');
  assert.strictEqual(db.getLink('disc1'), null);
});

test('tracked players are de-duplicated', () => {
  db.trackPlayer('Alpha');
  db.trackPlayer('Alpha');
  db.trackPlayer('Beta');
  const all = db.allTracked().sort();
  assert.deepStrictEqual(all, ['Alpha', 'Beta']);
});

test('snapshots: add and query by time', () => {
  const base = Date.now();
  const s = (money) => ({ money, shards: 0, kills: 0, deaths: 0, playtime: 0, placed: 0, broken: 0, mobs: 0, spent: 0, made: 0 });
  db.addSnapshot('Gamma', s(100), base - 30 * 3600_000); // 30h ago
  db.addSnapshot('Gamma', s(200), base - 2 * 3600_000);  // 2h ago
  db.addSnapshot('Gamma', s(300), base);                 // now

  assert.strictEqual(db.latestSnapshot('Gamma').money, 300);
  // newest snapshot at least 24h old
  assert.strictEqual(db.snapshotBefore('Gamma', base - 24 * 3600_000).money, 100);
  assert.strictEqual(db.snapshotsSince('Gamma', base - 3 * 3600_000).length, 2);
  assert.strictEqual(db.latestSnapshot('Unknown'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd donutdex && node --test test/db.test.js`
Expected: FAIL — `Cannot find module '../lib/db'`.

- [ ] **Step 3: Write the implementation**

```js
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

const dbPath = process.env.DONUT_DB_PATH || path.join(__dirname, '..', 'data', 'donut.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS links (
    discord_id TEXT PRIMARY KEY,
    ign        TEXT NOT NULL,
    linked_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tracked (
    ign   TEXT PRIMARY KEY,
    since INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS snapshots (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    ign      TEXT NOT NULL,
    ts       INTEGER NOT NULL,
    money    INTEGER, shards INTEGER, kills INTEGER, deaths INTEGER,
    playtime INTEGER, placed INTEGER, broken INTEGER, mobs INTEGER,
    spent    INTEGER, made INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_snap_ign_ts ON snapshots (ign, ts);
`);

const stmts = {
  setLink: db.prepare('INSERT INTO links (discord_id, ign, linked_at) VALUES (?, ?, ?) ON CONFLICT(discord_id) DO UPDATE SET ign = excluded.ign, linked_at = excluded.linked_at'),
  getLink: db.prepare('SELECT ign FROM links WHERE discord_id = ?'),
  delLink: db.prepare('DELETE FROM links WHERE discord_id = ?'),
  track: db.prepare('INSERT INTO tracked (ign, since) VALUES (?, ?) ON CONFLICT(ign) DO NOTHING'),
  allTracked: db.prepare('SELECT ign FROM tracked'),
  addSnap: db.prepare(`INSERT INTO snapshots
    (ign, ts, money, shards, kills, deaths, playtime, placed, broken, mobs, spent, made)
    VALUES (@ign, @ts, @money, @shards, @kills, @deaths, @playtime, @placed, @broken, @mobs, @spent, @made)`),
  latest: db.prepare('SELECT * FROM snapshots WHERE ign = ? ORDER BY ts DESC LIMIT 1'),
  before: db.prepare('SELECT * FROM snapshots WHERE ign = ? AND ts <= ? ORDER BY ts DESC LIMIT 1'),
  oldest: db.prepare('SELECT * FROM snapshots WHERE ign = ? ORDER BY ts ASC LIMIT 1'),
  since: db.prepare('SELECT * FROM snapshots WHERE ign = ? AND ts >= ? ORDER BY ts ASC'),
};

module.exports = {
  setLink(discordId, ign) { stmts.setLink.run(discordId, ign, Date.now()); },
  getLink(discordId) { const r = stmts.getLink.get(discordId); return r ? r.ign : null; },
  deleteLink(discordId) { stmts.delLink.run(discordId); },
  trackPlayer(ign) { stmts.track.run(ign, Date.now()); },
  allTracked() { return stmts.allTracked.all().map((r) => r.ign); },
  addSnapshot(ign, stats, ts = Date.now()) {
    stmts.addSnap.run({ ign, ts, ...stats });
  },
  latestSnapshot(ign) { return stmts.latest.get(ign) || null; },
  // newest snapshot at or before `cutoff`; falls back to the oldest snapshot.
  snapshotBefore(ign, cutoff) {
    return stmts.before.get(ign, cutoff) || stmts.oldest.get(ign) || null;
  },
  snapshotsSince(ign, since) { return stmts.since.all(ign, since); },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd donutdex && node --test test/db.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add donutdex/lib/db.js donutdex/test/db.test.js
git commit -m "feat: add sqlite db layer for links and snapshots"
```

---

## Task 6: Emoji map (`lib/emojis.js`)

**Files:**
- Create: `lib/emojis.js`

- [ ] **Step 1: Write the file**

```js
// Custom emoji ids supplied by the bot owner. Provisional stat assignments —
// adjust the right-hand side if the panel reveals more/better-matching emojis.
module.exports = {
  balance: '<:emerald:1505694549765390337>',
  shards: '<:amethyst:1505694549178060922>',
  kills: '<:sword:1505694548481806356>',
  playtime: '<:clock:1505694547785552004>',
  mobs: '<:zombie:1505694546569199706>',
  deaths: '<:skeleton:1505694544811917442>',
  broken: '<:cobblestone:1505694543587184710>',
  placed: '<:stone:1505694542664302682>',
  iron: '<:iron:1505694541796212827>',
  made: '<:gold:1505694540898635787>',
  redstone: '<:redstone:1505694540093194291>',
  shulker: '<:shulker:1505694539472703701>',
  spent: '<:chest:1505694538143109200>',
};
```

- [ ] **Step 2: Commit**

```bash
git add donutdex/lib/emojis.js
git commit -m "feat: add custom emoji map"
```

---

## Task 7: Embed builders (`lib/embeds.js`)

**Files:**
- Create: `lib/embeds.js`

- [ ] **Step 1: Write the file**

```js
const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const e = require('./emojis');
const { formatNumber, formatDuration, formatDelta, relativeTime } = require('./format');

// Renders "1.76M (-2.96B / 24h)" with a coloured arrow when a delta exists.
function valueWithDelta(current, prev, { duration = false } = {}) {
  const shown = duration ? formatDuration(current) : formatNumber(current);
  if (prev === null || prev === undefined) return `\`${shown}\``;
  const d = formatDelta(current, prev);
  const arrow = d.up ? '🟢' : d.down ? '🔴' : '⚪';
  return `\`${shown}\` ${arrow} \`${d.text} / 24h\``;
}

// stats: normalized object. prev: normalized object from a >=24h-old snapshot, or null.
// lookup: raw /lookup result. online: boolean.
function statsEmbed(ign, stats, prev, lookup, playtimeSeconds) {
  const p = prev || {};
  const has = (k) => (prev ? p[k] : null);
  const lastSeen = lookup && lookup.last_seen
    ? relativeTime(typeof lookup.last_seen === 'number' ? lookup.last_seen : Date.parse(lookup.last_seen))
    : 'unknown';
  const online = !!(lookup && (lookup.online || lookup.is_online));

  return new EmbedBuilder()
    .setColor(config.embedColor)
    .setAuthor({ name: `${ign}'s Statistics` })
    .setThumbnail(`https://mc-heads.net/avatar/${encodeURIComponent(ign)}/100`)
    .addFields(
      { name: `${e.balance} Balance`, value: valueWithDelta(stats.money, has('money')), inline: true },
      { name: `${e.shards} Shards`, value: valueWithDelta(stats.shards, has('shards')), inline: true },
      { name: `${e.kills} Kills`, value: valueWithDelta(stats.kills, has('kills')), inline: true },
      { name: `${e.deaths} Deaths`, value: valueWithDelta(stats.deaths, has('deaths')), inline: true },
      { name: `${e.mobs} Mobs Killed`, value: valueWithDelta(stats.mobs, has('mobs')), inline: true },
      { name: `${e.playtime} Playtime`, value: `\`${formatDuration(playtimeSeconds)}\``, inline: true },
      { name: `${e.placed} Blocks Placed`, value: valueWithDelta(stats.placed, has('placed')), inline: true },
      { name: `${e.broken} Blocks Broken`, value: valueWithDelta(stats.broken, has('broken')), inline: true },
      { name: '​', value: '​', inline: true },
      { name: `${e.spent} Money Spent (Shop)`, value: valueWithDelta(stats.spent, has('spent')), inline: true },
      { name: `${e.made} Money Made (Sell)`, value: valueWithDelta(stats.made, has('made')), inline: true },
      { name: '​', value: '​', inline: true },
    )
    .setFooter({ text: `Last seen ${lastSeen} • ${online ? 'Online' : 'Offline'} • ${config.brand}` })
    .setTimestamp();
}

function leaderboardEmbed(type, page, rows, callerIgn) {
  const lines = rows.map((r, i) => {
    const rank = (page - 1) * rows.length + i + 1;
    const mark = callerIgn && r.name && r.name.toLowerCase() === callerIgn.toLowerCase() ? '**' : '';
    return `\`#${rank}\` ${mark}${r.name}${mark} — \`${formatNumber(r.value)}\``;
  });
  return new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle(`${config.brand} — ${type} leaderboard`)
    .setDescription(lines.join('\n') || 'No entries.')
    .setFooter({ text: `Page ${page}` });
}

function auctionEmbed(page, items, query) {
  const lines = items.map((it) =>
    `**${it.name}**${it.amount > 1 ? ` ×${it.amount}` : ''} — \`${formatNumber(it.price)}\` • ${it.seller}`);
  return new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle(`${config.brand} — Auction House${query ? ` • "${query}"` : ''}`)
    .setDescription(lines.join('\n') || 'No listings on this page.')
    .setFooter({ text: `Page ${page}` });
}

function errorEmbed(message) {
  return new EmbedBuilder().setColor(0xcc4444).setDescription(`❌ ${message}`);
}

module.exports = { statsEmbed, leaderboardEmbed, auctionEmbed, errorEmbed, valueWithDelta };
```

- [ ] **Step 2: Smoke-test the module loads**

Run: `cd donutdex && node -e "require('./lib/embeds'); console.log('ok')"`
Expected: prints `ok` (no syntax/require errors).

- [ ] **Step 3: Commit**

```bash
git add donutdex/lib/embeds.js
git commit -m "feat: add embed builders"
```

---

## Task 8: Client bootstrap, command loader, and events

**Files:**
- Create: `index.js`, `events/ready.js`, `events/interactionCreate.js`

- [ ] **Step 1: Write `events/ready.js`**

```js
const { Events } = require('discord.js');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`[Donut Index] logged in as ${client.user.tag}`);
  },
};
```

- [ ] **Step 2: Write `events/interactionCreate.js`**

```js
const { Events, MessageFlags } = require('discord.js');
const { errorEmbed } = require('../lib/embeds');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;
      try {
        await command.execute(interaction);
      } catch (err) {
        console.error(`[command ${interaction.commandName}]`, err);
        const payload = { embeds: [errorEmbed(err.userMessage || 'Something went wrong.')], flags: MessageFlags.Ephemeral };
        if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
        else await interaction.reply(payload).catch(() => {});
      }
      return;
    }
    // Autocomplete
    if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (command && command.autocomplete) {
        try { await command.autocomplete(interaction); } catch (e) { console.error(e); }
      }
      return;
    }
    // Buttons — routed by a `name:...` customId prefix to the owning command.
    if (interaction.isButton()) {
      const owner = interaction.customId.split(':')[0];
      const command = interaction.client.commands.get(owner);
      if (command && command.button) {
        try { await command.button(interaction); }
        catch (err) {
          console.error(`[button ${interaction.customId}]`, err);
          await interaction.reply({ embeds: [errorEmbed('Button action failed.')], flags: MessageFlags.Ephemeral }).catch(() => {});
        }
      }
    }
  },
};
```

- [ ] **Step 3: Write `index.js`**

```js
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const config = require('./config');
const { startSnapshotJob } = require('./jobs/snapshot');

if (!config.token) { console.error('BOT_TOKEN missing in .env'); process.exit(1); }

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsDir, file));
  if (command.data && command.execute) client.commands.set(command.data.name, command);
  else console.warn(`[loader] ${file} is missing data/execute`);
}

const eventsDir = path.join(__dirname, 'events');
for (const file of fs.readdirSync(eventsDir).filter((f) => f.endsWith('.js'))) {
  const event = require(path.join(eventsDir, file));
  if (event.once) client.once(event.name, (...a) => event.execute(...a));
  else client.on(event.name, (...a) => event.execute(...a));
}

client.once('clientReady', () => startSnapshotJob());
client.login(config.token);
```

> Note: `commands/` and `jobs/snapshot.js` do not exist yet — `index.js` is not run until Task 16. This task only creates the files.

- [ ] **Step 4: Commit**

```bash
git add donutdex/index.js donutdex/events/ready.js donutdex/events/interactionCreate.js
git commit -m "feat: add client bootstrap, command loader, and event handlers"
```

---

## Task 9: Command deployment script (`deploy-commands.js`)

**Files:**
- Create: `deploy-commands.js`

- [ ] **Step 1: Write the file**

```js
const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');
const config = require('./config');

if (!config.token || !config.clientId) {
  console.error('BOT_TOKEN and CLIENT_ID are required in .env');
  process.exit(1);
}

const commands = [];
const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsDir, file));
  if (command.data) commands.push(command.data.toJSON());
}

const rest = new REST().setToken(config.token);

(async () => {
  try {
    if (config.guildId) {
      await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
      console.log(`Registered ${commands.length} commands to guild ${config.guildId} (instant).`);
    } else {
      await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
      console.log(`Registered ${commands.length} commands globally (propagation up to ~1h).`);
    }
  } catch (err) {
    console.error('Command registration failed:', err);
    process.exit(1);
  }
})();
```

- [ ] **Step 2: Commit**

```bash
git add donutdex/deploy-commands.js
git commit -m "feat: add slash command deployment script"
```

---

## Task 10: `/link` and `/unlink` commands

**Files:**
- Create: `commands/link.js`, `commands/unlink.js`

- [ ] **Step 1: Write `commands/link.js`**

```js
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const api = require('../lib/api');
const db = require('../lib/db');
const { errorEmbed } = require('../lib/embeds');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Discord account to a DonutSMP username')
    .addStringOption((o) =>
      o.setName('username').setDescription('Your Minecraft IGN').setRequired(true).setMaxLength(16)),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ign = interaction.options.getString('username').trim();
    try {
      await api.getLookup(ign); // throws NotFoundError if the player does not exist
    } catch (err) {
      if (err instanceof api.NotFoundError) {
        return interaction.editReply({ embeds: [errorEmbed(`No DonutSMP player named \`${ign}\` was found.`)] });
      }
      throw err;
    }
    db.setLink(interaction.user.id, ign);
    db.trackPlayer(ign);
    return interaction.editReply({ content: `✅ Linked to **${ign}**. \`/stats\` with no arguments now uses this account.` });
  },
};
```

- [ ] **Step 2: Write `commands/unlink.js`**

```js
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../lib/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unlink')
    .setDescription('Remove the link between your Discord account and your DonutSMP username'),

  async execute(interaction) {
    const current = db.getLink(interaction.user.id);
    if (!current) {
      return interaction.reply({ content: 'You have no linked account.', flags: MessageFlags.Ephemeral });
    }
    db.deleteLink(interaction.user.id);
    return interaction.reply({ content: `✅ Unlinked from **${current}**.`, flags: MessageFlags.Ephemeral });
  },
};
```

- [ ] **Step 3: Commit**

```bash
git add donutdex/commands/link.js donutdex/commands/unlink.js
git commit -m "feat: add /link and /unlink commands"
```

---

## Task 11: `/stats` command

**Files:**
- Create: `commands/stats.js`

- [ ] **Step 1: Write `commands/stats.js`**

```js
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const api = require('../lib/api');
const db = require('../lib/db');
const config = require('../config');
const { statsEmbed, errorEmbed } = require('../lib/embeds');

// Resolves the target IGN from the interaction options / linked account.
function resolveIgn(interaction) {
  const username = interaction.options.getString('username');
  if (username) return username.trim();
  const member = interaction.options.getUser('user');
  if (member) {
    const linked = db.getLink(member.id);
    if (!linked) return { error: `${member.username} has no linked DonutSMP account.` };
    return linked;
  }
  const own = db.getLink(interaction.user.id);
  if (!own) return { error: 'Provide a `username`, or `/link` your account first.' };
  return own;
}

async function buildStatsReply(ign) {
  const [{ stats }, lookup] = await Promise.all([
    api.getStats(ign),
    api.getLookup(ign).catch(() => null),
  ]);
  db.trackPlayer(ign);
  db.addSnapshot(ign, stats);

  const prevRow = db.snapshotBefore(ign, Date.now() - 24 * 3600_000);
  const prev = prevRow && prevRow.ts <= Date.now() - 60_000 ? prevRow : null;
  const playtimeSeconds = stats.playtime * config.playtimeUnitSeconds;

  const embed = statsEmbed(ign, stats, prev, lookup, playtimeSeconds);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`stats:history:${ign}:7d`).setLabel('Stats History').setStyle(ButtonStyle.Primary).setEmoji('📈'),
    new ButtonBuilder().setCustomId(`stats:sells:${ign}:1`).setLabel('Auction Sells').setStyle(ButtonStyle.Secondary).setEmoji('💰'),
  );
  return { embeds: [embed], components: [row] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show DonutSMP stats for a player')
    .addStringOption((o) => o.setName('username').setDescription('Minecraft IGN').setMaxLength(16))
    .addUserOption((o) => o.setName('user').setDescription('A linked Discord user')),

  async execute(interaction) {
    await interaction.deferReply();
    const resolved = resolveIgn(interaction);
    if (resolved && resolved.error) {
      return interaction.editReply({ embeds: [errorEmbed(resolved.error)] });
    }
    try {
      const reply = await buildStatsReply(resolved);
      return interaction.editReply(reply);
    } catch (err) {
      if (err instanceof api.NotFoundError) {
        return interaction.editReply({ embeds: [errorEmbed(`No DonutSMP player named \`${resolved}\` was found.`)] });
      }
      if (err instanceof api.RateLimitedError) {
        return interaction.editReply({ embeds: [errorEmbed('DonutSMP API is rate-limited right now — try again shortly.')] });
      }
      throw err;
    }
  },

  // Button handler — `stats:history:<ign>:<range>` and `stats:sells:<ign>:<page>`.
  // The history chart is wired in Task 12; sells in this step.
  async button(interaction) {
    const [, action, ign, arg] = interaction.customId.split(':');
    if (action === 'sells') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const page = Number(arg) || 1;
      const txns = await api.getAuctionTransactions(page).catch(() => []);
      const list = Array.isArray(txns) ? txns : txns.transactions || [];
      const mine = list.filter((t) => (t.seller || '').toLowerCase() === ign.toLowerCase());
      const { formatNumber } = require('../lib/format');
      const lines = mine.map((t) => `**${t.item || t.name}** — \`${formatNumber(t.price)}\``);
      return interaction.editReply({
        content: mine.length
          ? `**${ign}** — recent auction sells (page ${page}):\n${lines.join('\n')}`
          : `No auction sells found for **${ign}** on page ${page}.`,
      });
    }
    // action === 'history' handled in Task 12.
  },

  _buildStatsReply: buildStatsReply,
};
```

- [ ] **Step 2: Smoke-test the module loads**

Run: `cd donutdex && node -e "require('./commands/stats'); require('./commands/link'); require('./commands/unlink'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add donutdex/commands/stats.js
git commit -m "feat: add /stats command with history and sells buttons"
```

---

## Task 12: Balance-history chart (`lib/chart.js`)

**Files:**
- Create: `lib/chart.js`
- Modify: `commands/stats.js` (the `history` branch of `button`)

- [ ] **Step 1: Write `lib/chart.js`**

```js
const { createCanvas } = require('@napi-rs/canvas');
const { formatNumber } = require('./format');
const config = require('../config');

// points: [{ ts, value }]. Returns a PNG Buffer.
function renderBalanceChart(points, label, startAtZero) {
  const W = 900, H = 420, pad = 60;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#1e1f22';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(label, pad, 34);

  if (points.length < 2) {
    ctx.fillStyle = '#9aa0a6';
    ctx.font = '16px sans-serif';
    ctx.fillText('Not enough history yet — check back later.', pad, H / 2);
    return canvas.toBuffer('image/png');
  }

  const xs = points.map((p) => p.ts);
  const ys = points.map((p) => p.value);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = startAtZero ? 0 : Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const px = (t) => pad + ((t - minX) / spanX) * (W - pad * 2);
  const py = (v) => H - pad - ((v - minY) / spanY) * (H - pad * 2);

  ctx.strokeStyle = '#3a3b3e';
  ctx.fillStyle = '#9aa0a6';
  ctx.font = '12px sans-serif';
  for (let i = 0; i <= 4; i++) {
    const v = minY + (spanY * i) / 4;
    const y = py(v);
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
    ctx.fillText(formatNumber(v), 6, y + 4);
  }

  ctx.strokeStyle = `#${config.embedColor.toString(16).padStart(6, '0')}`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = px(p.ts), y = py(p.value);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  return canvas.toBuffer('image/png');
}

module.exports = { renderBalanceChart };
```

- [ ] **Step 2: Smoke-test the chart renders**

Run: `cd donutdex && node -e "const {renderBalanceChart}=require('./lib/chart'); const b=renderBalanceChart([{ts:1,value:10},{ts:2,value:30}],'Test',true); require('fs').writeFileSync('chart-smoke.png',b); console.log('bytes',b.length)"`
Expected: prints a positive byte count; `chart-smoke.png` opens as a valid image. Delete `chart-smoke.png` afterward.

- [ ] **Step 3: Replace the `history` comment in `commands/stats.js` `button()`**

In `commands/stats.js`, replace the line `// action === 'history' handled in Task 12.` with:

```js
    if (action === 'history') {
      await interaction.deferUpdate();
      const ranges = { '24h': 86400_000, '7d': 7 * 86400_000, '30d': 30 * 86400_000, all: Infinity };
      const range = ranges[arg] !== undefined ? arg : '7d';
      const since = range === 'all' ? 0 : Date.now() - ranges[range];
      const rows = db.snapshotsSince(ign, since);
      const points = rows.map((r) => ({ ts: r.ts, value: r.money }));
      const { renderBalanceChart } = require('../lib/chart');
      const png = renderBalanceChart(points, `${ign} — Balance (${range})`, true);
      const { AttachmentBuilder } = require('discord.js');
      const file = new AttachmentBuilder(png, { name: 'history.png' });

      const rangeRow = new ActionRowBuilder().addComponents(
        ...['24h', '7d', '30d', 'all'].map((r) =>
          new ButtonBuilder()
            .setCustomId(`stats:history:${ign}:${r}`)
            .setLabel(r)
            .setStyle(r === range ? ButtonStyle.Primary : ButtonStyle.Secondary)),
      );
      return interaction.editReply({ files: [file], components: [rangeRow] });
    }
```

- [ ] **Step 4: Smoke-test the module still loads**

Run: `cd donutdex && node -e "require('./commands/stats'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add donutdex/lib/chart.js donutdex/commands/stats.js
git commit -m "feat: add balance-history chart for /stats"
```

---

## Task 13: `/leaderboard` command

**Files:**
- Create: `commands/leaderboard.js`

> **Before writing:** confirm the leaderboard row shape from Task 4 Step 3 output. This task assumes each entry exposes a player name and a numeric value. The `normalizeRow` helper below maps common field names; adjust its candidate lists if the live shape differs.

- [ ] **Step 1: Write `commands/leaderboard.js`**

```js
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const api = require('../lib/api');
const db = require('../lib/db');
const { leaderboardEmbed, errorEmbed } = require('../lib/embeds');

const TYPES = ['money', 'shards', 'kills', 'deaths', 'playtime', 'placedblocks', 'brokenblocks', 'mobskilled', 'sell', 'shop'];

function normalizeRow(row) {
  const name = row.name || row.username || row.player || row.ign || 'unknown';
  const value = Number(row.value ?? row.amount ?? row.count ?? row.score ?? 0) || 0;
  return { name, value };
}

async function buildPage(type, page, callerIgn) {
  const raw = await api.getLeaderboard(type, page);
  const list = Array.isArray(raw) ? raw : raw.leaderboard || raw.entries || raw.players || [];
  const rows = list.map(normalizeRow);
  const embed = leaderboardEmbed(type, page, rows, callerIgn);
  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`leaderboard:${type}:${page - 1}`).setLabel('Prev').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(`leaderboard:${type}:${page + 1}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(rows.length === 0),
  );
  return { embeds: [embed], components: [nav] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show a DonutSMP leaderboard')
    .addStringOption((o) =>
      o.setName('type').setDescription('Leaderboard type').setRequired(true)
        .addChoices(...TYPES.map((t) => ({ name: t, value: t }))))
    .addIntegerOption((o) => o.setName('page').setDescription('Page number').setMinValue(1)),

  async execute(interaction) {
    await interaction.deferReply();
    const type = interaction.options.getString('type');
    const page = interaction.options.getInteger('page') || 1;
    const callerIgn = db.getLink(interaction.user.id);
    try {
      return interaction.editReply(await buildPage(type, page, callerIgn));
    } catch (err) {
      if (err instanceof api.RateLimitedError) {
        return interaction.editReply({ embeds: [errorEmbed('DonutSMP API is rate-limited — try again shortly.')] });
      }
      throw err;
    }
  },

  async button(interaction) {
    const [, type, pageStr] = interaction.customId.split(':');
    const page = Math.max(1, Number(pageStr) || 1);
    await interaction.deferUpdate();
    const callerIgn = db.getLink(interaction.user.id);
    return interaction.editReply(await buildPage(type, page, callerIgn));
  },
};
```

- [ ] **Step 2: Smoke-test the module loads**

Run: `cd donutdex && node -e "require('./commands/leaderboard'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add donutdex/commands/leaderboard.js
git commit -m "feat: add /leaderboard command with pagination"
```

---

## Task 14: `/ah` command

**Files:**
- Create: `commands/ah.js`

> **Before writing:** confirm the auction-listing shape from Task 4 Step 3 output. `normalizeListing` below maps common field names; adjust its candidate lists if the live shape differs.

- [ ] **Step 1: Write `commands/ah.js`**

```js
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const api = require('../lib/api');
const { auctionEmbed, errorEmbed } = require('../lib/embeds');

function normalizeListing(it) {
  return {
    name: it.item || it.name || it.item_name || 'Unknown item',
    amount: Number(it.amount ?? it.count ?? 1) || 1,
    price: Number(it.price ?? it.cost ?? 0) || 0,
    seller: it.seller || it.owner || it.player || 'unknown',
  };
}

const SORTS = {
  default: null,
  price_asc: (a, b) => a.price - b.price,
  price_desc: (a, b) => b.price - a.price,
};

async function buildPage(page, query, sort) {
  const raw = await api.getAuctionList(page);
  const list = Array.isArray(raw) ? raw : raw.auctions || raw.listings || raw.items || [];
  let items = list.map(normalizeListing);
  if (query) items = items.filter((it) => it.name.toLowerCase().includes(query.toLowerCase()));
  if (SORTS[sort]) items = items.slice().sort(SORTS[sort]);

  const embed = auctionEmbed(page, items.slice(0, 20), query);
  const enc = (s) => encodeURIComponent(s || '');
  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ah:${page - 1}:${enc(query)}:${sort}`).setLabel('Prev').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(`ah:${page + 1}:${enc(query)}:${sort}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(list.length === 0),
  );
  return { embeds: [embed], components: [nav] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ah')
    .setDescription('Browse the DonutSMP auction house')
    .addStringOption((o) => o.setName('search').setDescription('Filter by item name'))
    .addIntegerOption((o) => o.setName('page').setDescription('Page number').setMinValue(1))
    .addStringOption((o) =>
      o.setName('sort').setDescription('Sort order')
        .addChoices(
          { name: 'Price: low to high', value: 'price_asc' },
          { name: 'Price: high to low', value: 'price_desc' },
        )),

  async execute(interaction) {
    await interaction.deferReply();
    const query = interaction.options.getString('search') || '';
    const page = interaction.options.getInteger('page') || 1;
    const sort = interaction.options.getString('sort') || 'default';
    try {
      return interaction.editReply(await buildPage(page, query, sort));
    } catch (err) {
      if (err instanceof api.RateLimitedError) {
        return interaction.editReply({ embeds: [errorEmbed('DonutSMP API is rate-limited — try again shortly.')] });
      }
      throw err;
    }
  },

  async button(interaction) {
    const [, pageStr, queryEnc, sort] = interaction.customId.split(':');
    const page = Math.max(1, Number(pageStr) || 1);
    await interaction.deferUpdate();
    return interaction.editReply(await buildPage(page, decodeURIComponent(queryEnc || ''), sort || 'default'));
  },
};
```

- [ ] **Step 2: Smoke-test the module loads**

Run: `cd donutdex && node -e "require('./commands/ah'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add donutdex/commands/ah.js
git commit -m "feat: add /ah auction house command"
```

---

## Task 15: `/worth` command (stubbed pending price list)

**Files:**
- Create: `commands/worth.js`, `data/prices.json`

- [ ] **Step 1: Create `data/prices.json` with an empty starter map**

```json
{}
```

> The bot owner supplies real entries later, shaped `{ "diamond": 1200, "netherite_ingot": 45000 }` (lowercase item key → unit price).

- [ ] **Step 2: Write `commands/worth.js`**

```js
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const path = require('node:path');
const fs = require('node:fs');
const { formatNumber } = require('../lib/format');
const { errorEmbed } = require('../lib/embeds');
const config = require('../config');
const e = require('../lib/emojis');

const PRICES_PATH = path.join(__dirname, '..', 'data', 'prices.json');

function loadPrices() {
  try { return JSON.parse(fs.readFileSync(PRICES_PATH, 'utf8')); }
  catch { return {}; }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('worth')
    .setDescription('Look up the value of an item')
    .addStringOption((o) => o.setName('item').setDescription('Item name').setRequired(true))
    .addIntegerOption((o) => o.setName('amount').setDescription('Quantity').setMinValue(1)),

  async execute(interaction) {
    const prices = loadPrices();
    if (Object.keys(prices).length === 0) {
      return interaction.reply({
        embeds: [errorEmbed('The item price list has not been set up yet. Ask the bot owner to populate `data/prices.json`.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    const key = interaction.options.getString('item').trim().toLowerCase().replace(/\s+/g, '_');
    const amount = interaction.options.getInteger('amount') || 1;
    const unit = prices[key];
    if (unit === undefined) {
      return interaction.reply({ embeds: [errorEmbed(`No price on record for \`${key}\`.`)], flags: MessageFlags.Ephemeral });
    }
    const total = unit * amount;
    return interaction.reply({
      content: `${e.balance} **${key}** ×${amount} — unit \`${formatNumber(unit)}\`, total \`${formatNumber(total)}\``,
    });
  },
};
```

- [ ] **Step 3: Smoke-test the module loads**

Run: `cd donutdex && node -e "require('./commands/worth'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add donutdex/commands/worth.js donutdex/data/prices.json
git commit -m "feat: add /worth command (price list pending)"
```

---

## Task 16: Snapshot job and live verification

**Files:**
- Create: `jobs/snapshot.js`

- [ ] **Step 1: Write `jobs/snapshot.js`**

```js
const api = require('./../lib/api');
const db = require('./../lib/db');
const config = require('./../config');

// Snapshots every tracked player so 24h deltas and the history chart have data.
// Spaced out to stay well under the rate budget.
async function runSnapshot() {
  const igns = db.allTracked();
  if (igns.length === 0) return;
  console.log(`[snapshot] capturing ${igns.length} tracked players`);
  for (const ign of igns) {
    try {
      const { stats } = await api.getStats(ign);
      db.addSnapshot(ign, stats);
    } catch (err) {
      console.warn(`[snapshot] ${ign}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 500)); // ~2 req/s, gentle on the budget
  }
  console.log('[snapshot] done');
}

function startSnapshotJob() {
  runSnapshot().catch((e) => console.error('[snapshot] initial run failed', e));
  setInterval(() => runSnapshot().catch((e) => console.error('[snapshot]', e)), config.snapshotIntervalMs);
}

module.exports = { startSnapshotJob, runSnapshot };
```

- [ ] **Step 2: Run the full test suite**

Run: `cd donutdex && npm test`
Expected: PASS — all tests in `format.test.js`, `api.test.js`, `db.test.js`.

- [ ] **Step 3: Deploy commands and start the bot (requires real `.env`)**

Run: `cd donutdex && npm run deploy`
Expected: `Registered 6 commands ...`.

Run: `cd donutdex && npm start`
Expected: `[Donut Index] logged in as <tag>` and `[snapshot] ...` lines, no crash.

- [ ] **Step 4: Manual verification in Discord**

With the bot running and added to a test server (`GUILD_ID` set for instant commands):
- `/link username:ietz` → ephemeral success.
- `/stats` (no args) → embed for `ietz`, fields populated, thumbnail loads.
- `/stats username:<other>` → embed for that player.
- `/stats username:notarealplayer123` → clean "not found" error.
- Click **Stats History** → chart image; range buttons swap the chart.
- Click **Auction Sells** → ephemeral list (or "no sells" message).
- `/leaderboard type:money` → ranked list; Prev disabled on page 1, Next works.
- `/ah search:diamond` → filtered listings; pagination works.
- `/worth item:diamond` → "price list not set up" message (expected until prices added).
- `/unlink` → ephemeral success; `/stats` with no args now asks to link.

Record any failures and fix before committing.

- [ ] **Step 5: Commit**

```bash
git add donutdex/jobs/snapshot.js
git commit -m "feat: add periodic stat snapshot job"
```

---

## Task 17: README and finalization

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# Donut Index

A Discord bot for DonutSMP — player stats, leaderboards, auction house, and
Discord↔IGN account linking.

## Commands
- `/stats [username] [user]` — player statistics with 24h deltas and a balance-history chart
- `/link <username>` — link your Discord account to a DonutSMP IGN
- `/unlink` — remove your link
- `/leaderboard <type> [page]` — DonutSMP leaderboards
- `/ah [search] [page] [sort]` — browse the auction house
- `/worth <item> [amount]` — item value lookup (requires `data/prices.json`)

## Setup
1. `npm install`
2. Copy `.env.example` to `.env` and fill in `BOT_TOKEN`, `CLIENT_ID`, and
   `DONUTSMP_API_KEYS` (comma-separated for a larger rate-limit budget).
   Leave `GUILD_ID` blank for global (multi-server) commands; set it to a test
   server id for instant command updates during development.
3. `npm run deploy` — register slash commands.
4. `npm start` — run the bot (or `pm2 start ecosystem.config.js`).

## Notes
- DonutSMP API: 250 requests/min per key; the bot pools multiple keys and caches
  responses. Get a key with `/api` in-game.
- 24h deltas and the history chart are computed from snapshots stored in
  `data/donut.sqlite`; history accumulates after the bot has run for a while.
```

- [ ] **Step 2: Run the full test suite one final time**

Run: `cd donutdex && npm test`
Expected: PASS — all tests.

- [ ] **Step 3: Commit**

```bash
git add donutdex/README.md
git commit -m "docs: add Donut Index README"
```

---

## Self-Review Notes

- **Spec coverage:** `/stats` (T11) + history chart (T12) + deltas via snapshots (T5, T16); `/link` `/unlink` (T10); `/leaderboard` (T13); `/ah` (T14); `/worth` stubbed (T15); key pool + cache (T3–T4); multi-server global registration (T9). All spec sections mapped.
- **Deferred / assumption tasks:** raw `/stats`, leaderboard, and auction field names are verified live in Task 4 Step 3, with normalizer candidate lists adjusted before Tasks 13–14 rely on them. `config.playtimeUnitSeconds` is locked in the same step. These are explicit verification steps, not placeholders.
- **Type consistency:** normalized stat keys (`money, shards, kills, deaths, playtime, placed, broken, mobs, spent, made`) are identical across `api.normalizeStats`, `db` snapshot columns/params, `embeds.statsEmbed`, and `jobs/snapshot.js`. Button `customId` scheme `name:action:...` is consistent between `interactionCreate.js` routing and each command's `button()`.
- **Out of scope (per spec):** player net-worth (no inventory endpoint); link ownership verification (v2).
```
