const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');
const config = require('./config');

if (!config.token || !config.clientId) {
  console.error('BOT_TOKEN and CLIENT_ID are required in .env');
  process.exit(1);
}

const commands = [];
const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsDir, file));
  if (command.data) commands.push(command.data.toJSON());
}

const rest = new REST().setToken(config.token);

(async () => {
  try {
    // Register globally so the commands appear in every server the bot joins.
    // Global commands can take up to ~1h to propagate.
    await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
    console.log(`Registered ${commands.length} commands globally (propagation up to ~1h).`);

    // If a dev GUILD_ID is set, clear that guild's own command set — otherwise
    // its old guild-scoped copies show up duplicated next to the global ones.
    if (config.guildId) {
      await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: [] });
      console.log(`Cleared leftover guild-scoped commands from ${config.guildId}.`);
    }
  } catch (err) {
    console.error('Command registration failed:', err);
    process.exit(1);
  }
})();
