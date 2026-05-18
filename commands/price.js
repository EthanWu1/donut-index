const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('node:path');
const fs = require('node:fs');
const { getAuctionIndex } = require('../jobs/auction');
const { itemEmoji } = require('../lib/itemEmojis');
const { errorEmbed } = require('../lib/embeds');
const { formatNumber, relativeTime } = require('../lib/format');
const config = require('../config');

const PRICES_PATH = path.join(__dirname, '..', 'data', 'prices.json');
function loadPrices() {
  try { return JSON.parse(fs.readFileSync(PRICES_PATH, 'utf8')); }
  catch { return {}; }
}

// Distinct item names across both indexes, for autocomplete.
function itemNames() {
  const { listings, transactions } = getAuctionIndex();
  const set = new Set();
  for (const x of transactions) set.add(x.name);
  for (const x of listings) set.add(x.name);
  return [...set];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('price')
    .setDescription('Average real sold price of an item on the auction house')
    .addStringOption((o) =>
      o.setName('item').setDescription('Item name').setRequired(true).setAutocomplete(true)),

  async autocomplete(interaction) {
    const q = interaction.options.getFocused().toLowerCase();
    const out = itemNames().filter((n) => n.toLowerCase().includes(q)).slice(0, 25);
    await interaction.respond(out.map((n) => ({ name: n, value: n })));
  },

  async execute(interaction) {
    const { listings, transactions, updatedAt } = getAuctionIndex();
    if (updatedAt === 0) {
      return interaction.reply({
        embeds: [errorEmbed('The auction index is still building. Try again in a few seconds.')],
      });
    }
    const input = interaction.options.getString('item').trim();
    const q = input.toLowerCase();

    let sales = transactions.filter((t) => t.name.toLowerCase() === q);
    let label = input;
    if (sales.length === 0) {
      sales = transactions.filter((t) => t.name.toLowerCase().includes(q));
      if (sales.length) label = sales[0].name;
    }
    if (sales.length === 0) {
      return interaction.reply({ embeds: [errorEmbed(`No recent sales found for **${input}**.`)] });
    }
    const live = listings.filter((l) => l.name.toLowerCase() === label.toLowerCase());

    const units = sales.map((s) => s.unit).sort((a, b) => a - b);
    const avg = Math.round(units.reduce((s, v) => s + v, 0) / units.length);
    const median = Math.round(units[Math.floor(units.length / 2)]);
    const min = Math.round(units[0]);
    const max = Math.round(units[units.length - 1]);
    const cheapest = live.length
      ? Math.round(Math.min(...live.map((l) => l.price / Math.max(1, l.amount)))) : null;

    const book = loadPrices()[label.toLowerCase().replace(/\s+/g, '_')];
    const ic = itemEmoji(sales[0].key);

    const lines = [
      `### ${ic ? `${ic} ` : ''}${label} — Market Price`,
      '',
      `Average sold: **$${formatNumber(avg)}** per item`,
      `Median sold: \`$${formatNumber(median)}\``,
      `Range: \`$${formatNumber(min)}\` to \`$${formatNumber(max)}\``,
      `Based on **${sales.length}** recent sale${sales.length === 1 ? '' : 's'}`,
    ];
    if (cheapest !== null) lines.push(`Cheapest listed now: \`$${formatNumber(cheapest)}\``);
    if (book !== undefined) lines.push(`Shop sell price: \`$${formatNumber(book)}\``);

    const embed = new EmbedBuilder()
      .setColor(config.colors.auction)
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Auction data updated ${relativeTime(updatedAt)}` })
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  },
};
