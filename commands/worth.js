const { SlashCommandBuilder, MessageFlags } = require('discord.js');
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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('worth')
    .setDescription('Look up the value of an item')
    .addStringOption((o) => o.setName('item').setDescription('Item name').setRequired(true))
    .addIntegerOption((o) => o.setName('amount').setDescription('Quantity').setMinValue(1)),

  async execute(interaction) {
    const prices = loadPrices();
    if (Object.keys(prices).length === 0) {
      return interaction.reply({
        embeds: [errorEmbed('The item price list has not been set up yet. Ask the bot owner to populate `data/prices.json`.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    const key = interaction.options.getString('item').trim().toLowerCase().replace(/\s+/g, '_');
    const amount = interaction.options.getInteger('amount') || 1;
    const unit = prices[key];
    if (unit === undefined) {
      return interaction.reply({ embeds: [errorEmbed(`No price on record for \`${key}\`.`)], flags: MessageFlags.Ephemeral });
    }
    const total = unit * amount;
    return interaction.reply({
      content: `${e.balance} **${key}** ×${amount} — unit \`${formatNumber(unit)}\`, total \`${formatNumber(total)}\``,
    });
  },
};
