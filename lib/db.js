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
};
