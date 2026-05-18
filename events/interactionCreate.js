const { Events, MessageFlags } = require('discord.js');
const { errorEmbed } = require('../lib/embeds');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;
      try {
        await command.execute(interaction);
      } catch (err) {
        console.error(`[command ${interaction.commandName}]`, err);
        const payload = { embeds: [errorEmbed(err.userMessage || 'Something went wrong.')], flags: MessageFlags.Ephemeral };
        if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
        else await interaction.reply(payload).catch(() => {});
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
          console.error(`[select ${interaction.customId}]`, err);
          await interaction.reply({ embeds: [errorEmbed('Menu action failed.')], flags: MessageFlags.Ephemeral }).catch(() => {});
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
          console.error(`[button ${interaction.customId}]`, err);
          await interaction.reply({ embeds: [errorEmbed('Button action failed.')], flags: MessageFlags.Ephemeral }).catch(() => {});
        }
      }
    }
  },
};
