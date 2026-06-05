const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const api = require('../lib/api');
const db = require('../lib/db');
const { compareEmbed } = require('../lib/compareStats');
const { renderCompareCard } = require('../lib/compareCard');
const { errorEmbed } = require('../lib/embeds');

async function loadPlayer(ign) {
  const { stats } = await api.getStats(ign);
  db.trackPlayer(ign);
  db.addSnapshot(ign, stats);
  return stats;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('compare')
    .setDescription('Compare two DonutSMP players')
    .addStringOption((o) =>
      o.setName('first').setDescription('First Minecraft IGN').setRequired(true).setMaxLength(16).setAutocomplete(true))
    .addStringOption((o) =>
      o.setName('second').setDescription('Second Minecraft IGN').setRequired(true).setMaxLength(16).setAutocomplete(true)),

  async autocomplete(interaction) {
    const q = interaction.options.getFocused().toLowerCase();
    const out = db.allTracked().filter((i) => i.toLowerCase().includes(q)).slice(0, 25);
    await interaction.respond(out.map((i) => ({ name: i, value: i })));
  },

  async execute(interaction) {
    await interaction.deferReply();
    const first = interaction.options.getString('first').trim();
    const second = interaction.options.getString('second').trim();
    if (first.toLowerCase() === second.toLowerCase()) {
      return interaction.editReply({ embeds: [errorEmbed('Choose two different players to compare.')] });
    }

    try {
      const firstStats = await loadPlayer(first);
      const secondStats = await loadPlayer(second);
      const file = new AttachmentBuilder(renderCompareCard(first, firstStats, second, secondStats), { name: 'compare.png' });
      const embed = compareEmbed(first, firstStats, second, secondStats)
        .setImage('attachment://compare.png');
      return interaction.editReply({ embeds: [embed], files: [file] });
    } catch (err) {
      if (err instanceof api.NotFoundError) {
        return interaction.editReply({ embeds: [errorEmbed('One of those DonutSMP players was not found.')] });
      }
      if (err instanceof api.RateLimitedError) {
        return interaction.editReply({ embeds: [errorEmbed('DonutSMP API is rate-limited right now. Try again shortly.')] });
      }
      throw err;
    }
  },
};
