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
  CREATE TABLE IF NOT EXISTS pending_links (
    discord_id      TEXT PRIMARY KEY,
    ign             TEXT NOT NULL,
    code            INTEGER NOT NULL,
    user_baseline   INTEGER NOT NULL,
    target_baseline INTEGER NOT NULL,
    expires_at      INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pay_watches (
    id             TEXT PRIMARY KEY,
    status         TEXT NOT NULL,
    channel_id     TEXT,
    message_id     TEXT,
    creator_id     TEXT,
    payer_id       TEXT,
    payer_ign      TEXT NOT NULL,
    receiver_ign   TEXT NOT NULL,
    amount         INTEGER NOT NULL,
    reason         TEXT,
    payer_start    INTEGER NOT NULL,
    receiver_start INTEGER NOT NULL,
    created_at     INTEGER NOT NULL,
    expires_at     INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS schematic_names (
    thread_id TEXT PRIMARY KEY,
    file_name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auction_cache (
    id                INTEGER PRIMARY KEY CHECK (id = 1),
    updated_at        INTEGER NOT NULL,
    listings_json     TEXT NOT NULL,
    transactions_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auction_price_history (
    item_key           TEXT NOT NULL,
    item_name          TEXT NOT NULL,
    ts                 INTEGER NOT NULL,
    lowest_stack_price INTEGER NOT NULL,
    source             TEXT NOT NULL,
    samples            INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (item_key, ts, source)
  );
  CREATE INDEX IF NOT EXISTS idx_auction_price_key_ts
    ON auction_price_history (item_key, ts);
`);
// Older builds recorded 64-item stack prices in this table under raw/daily
// sources. Those rows are intentionally discarded so /history cannot mix old
// stack data with the one-item prices recorded by current builds.
db.prepare("DELETE FROM auction_price_history WHERE source NOT IN ('unit_raw', 'unit_daily')").run();

const stmts = {
  setLink: db.prepare('INSERT INTO links (discord_id, ign, linked_at) VALUES (?, ?, ?) ON CONFLICT(discord_id) DO UPDATE SET ign = excluded.ign, linked_at = excluded.linked_at'),
  getLink: db.prepare('SELECT ign FROM links WHERE discord_id = ?'),
  getDiscordByIgn: db.prepare('SELECT discord_id FROM links WHERE lower(ign) = lower(?) ORDER BY linked_at DESC LIMIT 1'),
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
  setPendingLink: db.prepare(`INSERT INTO pending_links
    (discord_id, ign, code, user_baseline, target_baseline, expires_at)
    VALUES (@discordId, @ign, @code, @userBaseline, @targetBaseline, @expiresAt)
    ON CONFLICT(discord_id) DO UPDATE SET
      ign = excluded.ign, code = excluded.code,
      user_baseline = excluded.user_baseline,
      target_baseline = excluded.target_baseline,
      expires_at = excluded.expires_at`),
  getPendingLink: db.prepare('SELECT * FROM pending_links WHERE discord_id = ?'),
  delPendingLink: db.prepare('DELETE FROM pending_links WHERE discord_id = ?'),
  clearExpiredPendingLinks: db.prepare('DELETE FROM pending_links WHERE expires_at < ?'),
  addWatch: db.prepare(`INSERT INTO pay_watches
    (id, status, channel_id, message_id, creator_id, payer_id, payer_ign, receiver_ign,
     amount, reason, payer_start, receiver_start, created_at, expires_at)
    VALUES (@id, @status, @channelId, @messageId, @creatorId, @payerId, @payerIgn,
     @receiverIgn, @amount, @reason, @payerStart, @receiverStart, @createdAt, @expiresAt)`),
  getWatch: db.prepare('SELECT * FROM pay_watches WHERE id = ?'),
  watchesByStatus: db.prepare('SELECT * FROM pay_watches WHERE status = ? ORDER BY created_at ASC'),
  setWatchMessage: db.prepare('UPDATE pay_watches SET channel_id = ?, message_id = ? WHERE id = ?'),
  setWatchStatus: db.prepare('UPDATE pay_watches SET status = ? WHERE id = ?'),
  setSchematicName: db.prepare('INSERT INTO schematic_names (thread_id, file_name) VALUES (?, ?) ON CONFLICT(thread_id) DO UPDATE SET file_name = excluded.file_name'),
  getSchematicName: db.prepare('SELECT file_name FROM schematic_names WHERE thread_id = ?'),
  delSchematicName: db.prepare('DELETE FROM schematic_names WHERE thread_id = ?'),
  saveAuctionCache: db.prepare(`INSERT INTO auction_cache
    (id, updated_at, listings_json, transactions_json) VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      updated_at = excluded.updated_at,
      listings_json = excluded.listings_json,
      transactions_json = excluded.transactions_json`),
  getAuctionCache: db.prepare('SELECT * FROM auction_cache WHERE id = 1'),
  clearAuctionCache: db.prepare('DELETE FROM auction_cache WHERE id = 1 AND updated_at < ?'),
  addAuctionPoint: db.prepare(`INSERT OR REPLACE INTO auction_price_history
    (item_key, item_name, ts, lowest_stack_price, source, samples)
    VALUES (@key, @name, @ts, @lowestStackPrice, @source, @samples)`),
  rawAuctionPointsBefore: db.prepare(`SELECT * FROM auction_price_history
    WHERE source = 'unit_raw' AND ts < ? ORDER BY item_key, ts ASC`),
  deleteRawAuctionPointsBefore: db.prepare(`DELETE FROM auction_price_history
    WHERE source = 'unit_raw' AND ts < ?`),
  auctionHistoryByKey: db.prepare(`SELECT * FROM auction_price_history
    WHERE item_key = ? AND ts >= ? AND source IN ('unit_raw', 'unit_daily') ORDER BY ts ASC`),
  auctionHistoryByName: db.prepare(`SELECT * FROM auction_price_history
    WHERE lower(item_name) = lower(?) AND ts >= ? AND source IN ('unit_raw', 'unit_daily') ORDER BY ts ASC`),
  auctionHistorySearch: db.prepare(`SELECT item_key, item_name, MAX(ts) AS last_ts
    FROM auction_price_history
    WHERE (lower(item_key) LIKE lower(?) OR lower(item_name) LIKE lower(?))
      AND source IN ('unit_raw', 'unit_daily')
    GROUP BY item_key, item_name
    ORDER BY last_ts DESC
    LIMIT ?`),
};

const DAY_MS = 24 * 60 * 60 * 1000;

function parseJsonArray(text) {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function cleanItemKey(key) {
  return String(key || '')
    .replace(/^minecraft:/i, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function unitPriceForListing(listing) {
  const amount = Math.max(1, Number(listing && listing.amount) || 1);
  const price = Math.max(0, Number(listing && listing.price) || 0);
  if (price > 0) return price / amount;
  const stackPrice = Number(listing && listing.stackPrice);
  return stackPrice > 0 ? stackPrice / 64 : 0;
}

function averageCheapestUnitPrice(unitPrices, sampleLimit = 8) {
  const sorted = (unitPrices || [])
    .map(Number)
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return { unitPrice: 0, samples: 0 };
  const baseline = sorted[0];
  const sample = sorted
    .filter((v) => v <= baseline * 2)
    .slice(0, sampleLimit);
  const usable = sample.length ? sample : [baseline];
  return {
    unitPrice: Math.round(usable.reduce((sum, v) => sum + v, 0) / usable.length),
    samples: usable.length,
  };
}

function auctionPointRow(point, ts, source = 'unit_raw', samples = 1) {
  const key = cleanItemKey(point.key || point.item_key || point.name);
  const unitPrice = Number(point.unitPrice ?? point.lowestStackPrice ?? point.lowest_stack_price) || 0;
  return {
    key,
    name: String(point.name || key || 'Unknown item'),
    ts,
    lowestStackPrice: Math.max(0, Math.floor(unitPrice)),
    source,
    samples: Math.max(1, Number(point.samples ?? samples) || 1),
  };
}

function mapAuctionHistoryRow(row) {
  return {
    key: row.item_key,
    name: row.item_name,
    ts: row.ts,
    lowestStackPrice: row.lowest_stack_price,
    unitPrice: row.lowest_stack_price,
    source: row.source,
    samples: row.samples,
  };
}

module.exports = {
  setLink(discordId, ign) { stmts.setLink.run(discordId, ign, Date.now()); },
  getLink(discordId) { const r = stmts.getLink.get(discordId); return r ? r.ign : null; },
  getDiscordIdByIgn(ign) { const r = stmts.getDiscordByIgn.get(ign); return r ? r.discord_id : null; },
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

  // Pending /link verifications — persisted so a restart doesn't drop a
  // verification the user is mid-way through.
  setPendingLink(discordId, p) {
    stmts.setPendingLink.run({
      discordId,
      ign: p.ign,
      code: p.code,
      userBaseline: p.userBaseline,
      targetBaseline: p.targetBaseline,
      expiresAt: p.expiresAt,
    });
  },
  getPendingLink(discordId) {
    const r = stmts.getPendingLink.get(discordId);
    return r ? {
      ign: r.ign,
      code: r.code,
      userBaseline: r.user_baseline,
      targetBaseline: r.target_baseline,
      expiresAt: r.expires_at,
    } : null;
  },
  deletePendingLink(discordId) { stmts.delPendingLink.run(discordId); },
  clearExpiredPendingLinks() { stmts.clearExpiredPendingLinks.run(Date.now()); },

  // /pay watches — persisted so active watches resume after a restart.
  addWatch(w) { stmts.addWatch.run(w); },
  getWatch(id) { return stmts.getWatch.get(id) || null; },
  watchesByStatus(status) { return stmts.watchesByStatus.all(status); },
  setWatchMessage(id, channelId, messageId) {
    stmts.setWatchMessage.run(channelId, messageId, id);
  },
  setWatchStatus(id, status) { stmts.setWatchStatus.run(status, id); },

  // Staff-set filename override for a schematic (keyed by forum thread id).
  setSchematicName(threadId, name) { stmts.setSchematicName.run(threadId, name); },
  getSchematicName(threadId) {
    const r = stmts.getSchematicName.get(threadId);
    return r ? r.file_name : null;
  },
  deleteSchematicName(threadId) { stmts.delSchematicName.run(threadId); },

  // Auction cache/history. Cache is short-lived fallback data; history is
  // compacted into daily rows so long-term charts can stay useful indefinitely.
  saveAuctionCache({ listings = [], transactions = [], updatedAt = Date.now() }) {
    stmts.saveAuctionCache.run(
      updatedAt,
      JSON.stringify(listings),
      JSON.stringify(transactions),
    );
  },
  getAuctionCache(maxAgeMs, now = Date.now()) {
    const r = stmts.getAuctionCache.get();
    if (!r || now - r.updated_at > maxAgeMs) return null;
    return {
      listings: parseJsonArray(r.listings_json),
      transactions: parseJsonArray(r.transactions_json),
      updatedAt: r.updated_at,
      stale: true,
    };
  },
  clearExpiredAuctionCache(maxAgeMs, now = Date.now()) {
    stmts.clearAuctionCache.run(now - maxAgeMs);
  },
  recordAuctionPricePoint(point, ts = Date.now()) {
    const row = auctionPointRow(point, ts);
    if (!row.key || row.lowestStackPrice <= 0) return;
    stmts.addAuctionPoint.run(row);
  },
  recordAuctionPriceSnapshot(listings, ts = Date.now()) {
    const grouped = new Map();
    for (const listing of listings || []) {
      const key = cleanItemKey(listing.key || listing.name);
      if (!key) continue;
      const unitPrice = unitPriceForListing(listing);
      if (unitPrice <= 0) continue;
      const current = grouped.get(key) || { key, name: listing.name || key, unitPrices: [] };
      current.unitPrices.push(unitPrice);
      grouped.set(key, current);
    }
    const rows = [...grouped.values()].map((row) => {
      const averaged = averageCheapestUnitPrice(row.unitPrices);
      return {
        key: row.key,
        name: row.name,
        unitPrice: averaged.unitPrice,
        samples: averaged.samples,
      };
    }).filter((row) => row.unitPrice > 0);
    const insert = db.transaction((rows) => {
      for (const row of rows) stmts.addAuctionPoint.run(auctionPointRow(row, ts));
    });
    insert(rows);
  },
  compactAuctionHistory(now = Date.now(), rawRetentionMs = 30 * DAY_MS) {
    const cutoff = now - rawRetentionMs;
    const oldRows = stmts.rawAuctionPointsBefore.all(cutoff);
    if (oldRows.length === 0) return;
    const grouped = new Map();
    for (const row of oldRows) {
      const day = Math.floor(row.ts / DAY_MS) * DAY_MS;
      const key = `${row.item_key}:${day}`;
      const g = grouped.get(key) || {
        key: row.item_key,
        name: row.item_name,
        ts: day,
        lowestStackPrice: row.lowest_stack_price,
        source: 'unit_daily',
        samples: 0,
      };
      g.lowestStackPrice = Math.min(g.lowestStackPrice, row.lowest_stack_price);
      g.samples += 1;
      grouped.set(key, g);
    }
    const apply = db.transaction((rows) => {
      for (const row of rows) stmts.addAuctionPoint.run(row);
      stmts.deleteRawAuctionPointsBefore.run(cutoff);
    });
    apply([...grouped.values()]);
  },
  auctionPriceHistory(item, since = 0) {
    const key = cleanItemKey(item);
    let rows = key ? stmts.auctionHistoryByKey.all(key, since) : [];
    if (rows.length === 0) rows = stmts.auctionHistoryByName.all(String(item || ''), since);
    return rows.map(mapAuctionHistoryRow);
  },
  auctionHistoryItems(query = '', limit = 25) {
    const q = `%${String(query || '').trim()}%`;
    return stmts.auctionHistorySearch.all(q, q, limit)
      .map((r) => ({ key: r.item_key, name: r.item_name }));
  },
  averageCheapestUnitPrice,
};
