const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('node:path');
const fs = require('node:fs');
const { formatNumber } = require('../lib/format');
const { errorEmbed } = require('../lib/embeds');
const config = require('../config');
const e = require('../lib/emojis');

const PRICES_PATH = path.join(__dirname, '..', 'data', 'prices.json');

function loadPrices() {
  try { return JSON.parse(fs.readFileSync(PRICES_PATH, 'utf8')); }
  catch { return {}; }
}

const SMALL = new Set(['of', 'the', 'and', 'a', 'an', 'in', 'on']);
function titleCase(key) {
  return key.split('_').map((w, i) =>
    (i > 0 && SMALL.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Resolve a user's text to a price key: exact match, then word-subset fuzzy.
function resolve(prices, input) {
  const norm = input.trim().toLowerCase();
  const exact = norm.replace(/\s+/g, '_');
  if (prices[exact] !== undefined) return { key: exact };

  const words = norm.split(/\s+/).filter(Boolean);
  const matches = Object.keys(prices).filter((k) => {
    const kw = k.split('_');
    return words.every((w) => kw.some((x) => x.includes(w)));
  });
  if (matches.length === 0) return { none: true };
  if (matches.length === 1) return { key: matches[0] };
  matches.sort((a, b) => a.length - b.length);
  return { key: matches[0], also: matches.slice(1, 6) };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('worth')
    .setDescription('Look up the sell value of an item')
    .addStringOption((o) => o.setName('item').setDescription('Item name').setRequired(true)),

  async execute(interaction) {
    const prices = loadPrices();
    if (Object.keys(prices).length === 0) {
      return interaction.reply({
        embeds: [errorEmbed('The item price list is not set up yet.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    const input = interaction.options.getString('item');
    const r = resolve(prices, input);
    if (r.none) {
      return interaction.reply({
        embeds: [errorEmbed(`No price on record for **${input}**.`)],
        flags: MessageFlags.Ephemeral,
      });
    }
    const name = titleCase(r.key);
    const price = prices[r.key];
    const embed = new EmbedBuilder()
      .setColor(config.colors.worth)
      .setDescription(`${e.gold_nugget} One **${name}** is worth **$${formatNumber(price)}** at 1x.`);
    if (r.also && r.also.length) {
      embed.setFooter({ text: `Also matched: ${r.also.map(titleCase).join(', ')}` });
    }
    return interaction.reply({ embeds: [embed] });
  },
};
