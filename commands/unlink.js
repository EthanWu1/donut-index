const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const db = require('../lib/db');

function confirmRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('unlink:confirm').setLabel('Unlink').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('unlink:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unlink')
    .setDescription('Remove the link between your Discord account and your DonutSMP username'),

  async execute(interaction) {
    const current = db.getLink(interaction.user.id);
    if (!current) {
      return interaction.reply({ content: 'You have no linked account.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({
      content: `Are you sure you want to unlink from **${current}**?`,
      components: [confirmRow()],
      flags: MessageFlags.Ephemeral,
    });
  },

  async button(interaction) {
    const [, action] = interaction.customId.split(':');
    const current = db.getLink(interaction.user.id);
    if (!current) {
      return interaction.update({ content: 'You have no linked account.', components: [] });
    }
    if (action === 'cancel') {
      return interaction.update({ content: `Kept linked to **${current}**.`, components: [] });
    }
    if (action !== 'confirm') return undefined;

    db.deleteLink(interaction.user.id);
    return interaction.update({ content: `Unlinked from **${current}**.`, components: [] });
  },
};
