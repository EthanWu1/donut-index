const api = require('./../lib/api');
const config = require('./../config');

const TYPES = [
  'money', 'shards', 'kills', 'deaths', 'playtime',
  'placedblocks', 'brokenblocks', 'mobskilled', 'sell', 'shop',
];

// boards: { type: [lowercased ign in rank order] } — powers /rank.
let boards = {};
let updatedAt = 0;
let building = false;

function getLeaderboardIndex() {
  return { boards, updatedAt, building };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rowName(row) {
  return String(row.name || row.username || row.player || row.ign || '').toLowerCase();
}

async function rebuild() {
  if (building) return;
  building = true;
  try {
    const next = {};
    for (const type of TYPES) {
      const names = [];
      for (let p = 1; p <= config.lbMaxPages; p++) {
        let raw;
        try {
          raw = await api.getLeaderboard(type, p);
        } catch (e) {
          console.warn(`[leaderboard] ${type} page ${p}: ${e.message}`);
          break;
        }
        const list = Array.isArray(raw)
          ? raw : (raw.leaderboard || raw.entries || raw.players || []);
        if (!Array.isArray(list) || list.length === 0) break;
        for (const r of list) names.push(rowName(r));
        await sleep(250);
      }
      if (names.length) next[type] = names;
    }
    if (Object.keys(next).length) {
      boards = next;
      updatedAt = Date.now();
    }
    console.log(`[leaderboard] indexed ${Object.keys(boards).length} boards`);
  } finally {
    building = false;
  }
}

function startLeaderboardJob() {
  rebuild().catch((e) => console.error('[leaderboard] initial build failed', e));
  setInterval(() => rebuild().catch((e) => console.error('[leaderboard]', e)), config.lbRefreshMs);
}

module.exports = { startLeaderboardJob, getLeaderboardIndex, TYPES };
