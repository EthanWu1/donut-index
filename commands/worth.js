const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('node:path');
const fs = require('node:fs');
const { formatNumber } = require('../lib/format');
const { errorEmbed, WIDE } = require('../lib/embeds');
const { itemEmoji } = require('../lib/itemEmojis');
const config = require('../config');

const PRICES_PATH = path.join(__dirname, '..', 'data', 'prices.json');
const MAX_LIST = 40;

function loadPrices() {
  try { return JSON.parse(fs.readFileSync(PRICES_PATH, 'utf8')); }
  catch { return {}; }
}

const SMALL = new Set(['of', 'the', 'and', 'a', 'an', 'in', 'on']);
function titleCase(key) {
  return key.split('_').map((w, i) =>
    (i > 0 && SMALL.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Every price key whose words all contain one of the input words.
function findMatches(prices, input) {
  const norm = input.trim().toLowerCase();
  const words = norm.split(/\s+/).filter(Boolean);
  let matches = Object.keys(prices).filter((k) => {
    const kw = k.split('_');
    return words.every((w) => kw.some((x) => x.includes(w)));
  });
  const exact = norm.replace(/\s+/g, '_');
  matches = matches.filter((m) => m !== exact).sort();
  if (prices[exact] !== undefined) matches.unshift(exact);
  return matches;
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
    const matches = findMatches(prices, input);
    if (matches.length === 0) {
      return interaction.reply({
        embeds: [errorEmbed(`No price on record for **${input}**.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    let desc;
    if (matches.length === 1) {
      const k = matches[0];
      const ic = itemEmoji(k);
      desc = `One ${ic ? `${ic} ` : ''}**${titleCase(k)}** is worth **$${formatNumber(prices[k])}** at 1x.`;
    } else {
      const shown = matches.slice(0, MAX_LIST);
      const lines = shown.map((k) => {
        const ic = itemEmoji(k);
        return `${ic ? `${ic} ` : ''}**${titleCase(k)}** \`$${formatNumber(prices[k])}\``;
      });
      desc = `### Worth: "${input}"\n\n${lines.join('\n')}`;
      if (matches.length > MAX_LIST) {
        desc += `\n\n_...and ${matches.length - MAX_LIST} more. Try a more specific term._`;
      }
    }

    const embed = new EmbedBuilder()
      .setColor(config.colors.worth)
      .setDescription(`${desc}\n${WIDE}`);
    return interaction.reply({ embeds: [embed] });
  },
};
