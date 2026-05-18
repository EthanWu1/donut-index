const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const api = require('../lib/api');
const db = require('../lib/db');
const { errorEmbed } = require('../lib/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Discord account to a DonutSMP username')
    .addStringOption((o) =>
      o.setName('username').setDescription('Your Minecraft IGN').setRequired(true).setMaxLength(16)),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ign = interaction.options.getString('username').trim();
    // Validate via /stats — it works for offline players, unlike /lookup
    // (DonutSMP's /lookup returns HTTP 500 for anyone not currently online).
    // Only a confirmed 404 rejects the link; other API errors are tolerated.
    try {
      await api.getStats(ign);
    } catch (err) {
      if (err instanceof api.NotFoundError) {
        return interaction.editReply({ embeds: [errorEmbed(`No DonutSMP player named \`${ign}\` was found.`)] });
      }
      // API flaky or unreachable — link anyway rather than block the user.
    }
    db.setLink(interaction.user.id, ign);
    db.trackPlayer(ign);
    return interaction.editReply({ content: `✅ Linked to **${ign}**. \`/stats\` with no arguments now uses this account.` });
  },
};
