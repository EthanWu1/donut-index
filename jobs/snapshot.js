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
