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
`);

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
};

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
};
