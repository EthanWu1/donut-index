const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../lib/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unlink')
    .setDescription('Remove the link between your Discord account and your DonutSMP username'),

  async execute(interaction) {
    const current = db.getLink(interaction.user.id);
    if (!current) {
      return interaction.reply({ content: 'You have no linked account.', flags: MessageFlags.Ephemeral });
    }
    db.deleteLink(interaction.user.id);
    return interaction.reply({ content: `Unlinked from **${current}**.`, flags: MessageFlags.Ephemeral });
  },
};
