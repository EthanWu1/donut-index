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

    // If GUILD_ID is set, also register guild-scoped commands so updates are
    // available immediately while global commands propagate.
    if (config.guildId) {
      if (process.env.CLEAR_GUILD_COMMANDS === 'true') {
        await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: [] });
        console.log(`Cleared guild-scoped commands from ${config.guildId}.`);
      } else {
        await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
        console.log(`Registered ${commands.length} commands to guild ${config.guildId} for immediate availability.`);
      }
    }
  } catch (err) {
    console.error('Command registration failed:', err);
    process.exit(1);
  }
})();
