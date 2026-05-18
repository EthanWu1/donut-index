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
    schematic: 0x5865f2,
    error: 0xe04347,
  },
  // Auction house indexing: the whole AH is scanned into memory on a timer.
  // ~400 real pages; 600 caps the runaway case without truncating real data.
  ahMaxPages: 600,
  ahRefreshMs: 20 * 60 * 1000,
  // Recent sold-auction pages indexed for /price (the API caps this at 10).
  ahTxnPages: 10,
  // Leaderboard indexing for /rank.
  lbMaxPages: 20,
  lbRefreshMs: 15 * 60 * 1000,
  // Schematic index: Donut Index reads donutbot's schematic forum channel.
  // Only forum threads with at least one tag applied are listed.
  schematicForumChannelId: process.env.SCHEMATIC_FORUM_CHANNEL_ID || '1504844039546208386',
  schematicsRefreshMs: 15 * 60 * 1000,
  brand: 'Donut Index',
  // HoloPrint web app — /holoprint links here so the user can turn the
  // converted .mcstructure into a .holoprint.mcpack. Optional; if unset the
  // command still delivers the .mcstructure, just without the button.
  holoprintUrl: process.env.HOLOPRINT_URL || null,
  // /link ownership check: the user proves they own an IGN by paying a random
  // code amount to this account; the bot confirms it via balance deltas.
  linkVerifyTarget: process.env.LINK_VERIFY_TARGET || 'Vi2910NC',
  linkVerifyTimeoutMs: 15 * 60 * 1000,
  // /pay watches the DonutSMP API for a payment to land, then confirms it.
  payWatchTimeoutMs: 30 * 60 * 1000,
};
