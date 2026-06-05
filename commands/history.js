const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const db = require('../lib/db');
const config = require('../config');
const { renderChart } = require('../lib/chart');
const { errorEmbed } = require('../lib/embeds');

const RANGE_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeItem(input) {
  return String(input || '').trim().toLowerCase().replace(/\s+/g, '_');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('Show auction-house price history for an item')
    .addStringOption((o) =>
      o.setName('item').setDescription('Item name').setRequired(true).setAutocomplete(true)),

  async autocomplete(interaction) {
    const q = interaction.options.getFocused();
    const out = db.auctionHistoryItems(q, 25);
    await interaction.respond(out.map((i) => ({ name: i.name, value: i.name })));
  },

  async execute(interaction) {
    await interaction.deferReply();
    const input = interaction.options.getString('item');
    const rows = db.auctionPriceHistory(normalizeItem(input), Date.now() - RANGE_MS);
    if (rows.length < 2) {
      return interaction.editReply({ embeds: [errorEmbed(`Not enough auction history for **${input}** yet.`)] });
    }
    const name = rows[rows.length - 1].name || input;
    const points = rows.map((r) => ({ ts: r.ts, value: r.lowestStackPrice }));
    const png = renderChart(points, { money: true });
    const file = new AttachmentBuilder(png, { name: 'history.png' });
    const embed = new EmbedBuilder()
      .setColor(config.colors.history)
      .setDescription(`### ${name} AH History\n\nLowest known 64-item stack price.`)
      .setImage('attachment://history.png')
      .setFooter({ text: 'Detailed recent points plus compact daily history' })
      .setTimestamp();
    return interaction.editReply({ embeds: [embed], files: [file] });
  },
};
