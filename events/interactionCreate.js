const { Events, MessageFlags } = require('discord.js');
const { errorEmbed } = require('../lib/embeds');
const api = require('../lib/api');
const db = require('../lib/db');

// Logs an error and fully expands a Discord API rawError (e.g. the exact
// component/field that failed validation), which console.error truncates.
function logError(tag, err) {
  console.error(tag, err);
  if (err && err.rawError) {
    console.error(`${tag} rawError:`, JSON.stringify(err.rawError, null, 2));
  }
  if (err && err.requestBody) {
    console.error(`${tag} requestBody:`, JSON.stringify(err.requestBody, null, 2));
  }
}

function userMessageForError(err, fallback) {
  if (err && err.userMessage) return err.userMessage;
  if (err instanceof api.RateLimitedError) {
    return 'DonutSMP API is rate-limited right now. Try again shortly.';
  }
  if (err instanceof api.NotFoundError) {
    return 'No DonutSMP player or resource was found.';
  }
  if (err instanceof api.ApiError) {
    return 'The DonutSMP API service is not available right now. Try again in a moment.';
  }
  return fallback;
}

function errorPayload(err, fallback) {
  return {
    embeds: [errorEmbed(userMessageForError(err, fallback))],
    flags: MessageFlags.Ephemeral,
  };
}

async function respondWithError(interaction, err, fallback) {
  if (
    interaction.deferred
    && err instanceof api.ApiError
    && (
      (typeof interaction.isButton === 'function' && interaction.isButton())
      || (typeof interaction.isStringSelectMenu === 'function' && interaction.isStringSelectMenu())
    )
  ) {
    return;
  }
  const payload = errorPayload(err, fallback);
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload).catch(() => {});
  } else {
    await interaction.reply(payload).catch(() => {});
  }
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;
      // Start tracking the caller's linked account as soon as they use the bot,
      // so the snapshot job builds 24h history for every active user.
      try {
        const linkedIgn = db.getLink(interaction.user.id);
        if (linkedIgn) db.trackPlayer(linkedIgn);
      } catch { /* tracking is best-effort */ }
      try {
        await command.execute(interaction);
      } catch (err) {
        logError(`[command ${interaction.commandName}]`, err);
        await respondWithError(interaction, err, 'Something went wrong.');
      }
      return;
    }
    // Autocomplete
    if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (command && command.autocomplete) {
        try { await command.autocomplete(interaction); } catch (e) { console.error(e); }
      }
      return;
    }
    // String select menus — routed by customId prefix to the owning command.
    if (interaction.isStringSelectMenu()) {
      const owner = interaction.customId.split(':')[0];
      const command = interaction.client.commands.get(owner);
      if (command && command.selectMenu) {
        try { await command.selectMenu(interaction); }
        catch (err) {
          logError(`[select ${interaction.customId}]`, err);
          await respondWithError(interaction, err, 'Menu action failed.');
        }
      }
      return;
    }
    // Modal submits — routed by customId prefix to the owning command.
    if (interaction.isModalSubmit()) {
      const owner = interaction.customId.split(':')[0];
      const command = interaction.client.commands.get(owner);
      if (command && command.modal) {
        try { await command.modal(interaction); }
        catch (err) {
          logError(`[modal ${interaction.customId}]`, err);
          await respondWithError(interaction, err, 'Action failed.');
        }
      }
      return;
    }
    // Buttons — routed by a `name:...` customId prefix to the owning command.
    if (interaction.isButton()) {
      const owner = interaction.customId.split(':')[0];
      const command = interaction.client.commands.get(owner);
      if (command && command.button) {
        try { await command.button(interaction); }
        catch (err) {
          logError(`[button ${interaction.customId}]`, err);
          await respondWithError(interaction, err, 'Button action failed.');
        }
      }
    }
  },
};
