const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const api = require('../lib/api');
const db = require('../lib/db');
const { errorEmbed } = require('../lib/embeds');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Discord account to a DonutSMP username')
    .addStringOption((o) =>
      o.setName('username').setDescription('Your Minecraft IGN').setRequired(true).setMaxLength(16)),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ign = interaction.options.getString('username').trim();
    try {
      await api.getLookup(ign); // throws NotFoundError if the player does not exist
    } catch (err) {
      if (err instanceof api.NotFoundError) {
        return interaction.editReply({ embeds: [errorEmbed(`No DonutSMP player named \`${ign}\` was found.`)] });
      }
      throw err;
    }
    db.setLink(interaction.user.id, ign);
    db.trackPlayer(ign);
    return interaction.editReply({ content: `✅ Linked to **${ign}**. \`/stats\` with no arguments now uses this account.` });
  },
};
