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
