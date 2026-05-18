const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const config = require('./config');
const { startSnapshotJob } = require('./jobs/snapshot');
const { startAuctionJob } = require('./jobs/auction');
const { startLeaderboardJob } = require('./jobs/leaderboard');

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

client.once('clientReady', () => {
  startSnapshotJob();
  startAuctionJob();
  startLeaderboardJob();
});
client.login(config.token);
