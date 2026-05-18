const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const config = require('./config');
const { startSnapshotJob } = require('./jobs/snapshot');
const { startAuctionJob } = require('./jobs/auction');
const { startLeaderboardJob } = require('./jobs/leaderboard');
const { startSchematicsJob } = require('./jobs/schematics');

if (!config.token) { console.error('BOT_TOKEN missing in .env'); process.exit(1); }

// MessageContent is required so the schematics job can read the .litematic
// attachment (and body) on donutbot-authored forum posts — without it Discord
// strips attachments/content from messages this bot did not author.
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent],
});
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

client.once('clientReady', () => {
  startSnapshotJob();
  startSchematicsJob(client); // reads Discord, not the DonutSMP API — no contention
  // Leaderboards first (/rank), then the auction scan after a head start —
  // the auction listings scan is hundreds of pages and would otherwise
  // starve the leaderboard fetch of API rate-limit budget.
  startLeaderboardJob();
  setTimeout(startAuctionJob, 90_000);
});
client.login(config.token);
