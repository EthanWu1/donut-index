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
  // DonutSMP /stats returns playtime in milliseconds; multiply to get seconds.
  playtimeUnitSeconds: 0.001,
  // Per-feature embed colors, so each command reads as its own thing.
  colors: {
    online: 0x3ba55d,
    offline: 0xed4245,
    leaderboard: 0xf1b32e,
    auction: 0x4aa3df,
    worth: 0x3ba55d,
    history: 0x1abc9c,
    error: 0xe04347,
  },
  // How many auction pages to scan when a search term is given.
  ahSearchPages: 20,
  brand: 'Donut Index',
};
