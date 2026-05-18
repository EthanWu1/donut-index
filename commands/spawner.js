const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('node:path');
const fs = require('node:fs');
const config = require('../config');
const { itemEmoji } = require('../lib/itemEmojis');

// Skeleton bone curve (one pile of x spawners): y = a*e^(b*x + c) + d.
const BASE = { a: -0.39567, b: -0.00134606, c: 8.24358, d: 1505.35 };
function baseRate(x) {
  return Math.max(0, BASE.a * Math.exp(BASE.b * x + BASE.c) + BASE.d);
}

// Recommended pile size for splitting (midpoint of the 500-1000 guidance).
const STACK_SIZE = 750;

// Each spawner's drops, as a multiplier on the base bone curve.
const SPAWNERS = {
  skeleton: { label: 'Skeleton', drops: [
    { name: 'Bones', key: 'bone', priceKey: 'bone', mult: 1 },
    { name: 'Arrows', key: 'arrow', priceKey: 'arrow', mult: 0.5 },
  ] },
  cow: { label: 'Cow', drops: [
    { name: 'Raw Beef', key: 'beef', priceKey: 'raw_beef', mult: 1.5 },
  ] },
  pig: { label: 'Pig', drops: [
    { name: 'Raw Porkchop', key: 'porkchop', priceKey: 'raw_porkchop', mult: 1.5 },
  ] },
  creeper: { label: 'Creeper', drops: [
    { name: 'Gunpowder', key: 'gunpowder', priceKey: 'gunpowder', mult: 2 },
  ] },
  spider: { label: 'Spider', drops: [
    { name: 'String', key: 'string', priceKey: 'string', mult: 3 },
    { name: 'Spider Eyes', key: 'spider_eye', priceKey: 'spider_eye', mult: 1 },
  ] },
  blaze: { label: 'Blaze', drops: [
    { name: 'Blaze Powder', key: 'blaze_powder', priceKey: 'blaze_powder', mult: 5.5 },
  ] },
  iron_golem: { label: 'Iron Golem', drops: [
    { name: 'Iron Ingots', key: 'iron_ingot', priceKey: 'iron_ingot', mult: 1 },
  ] },
};

function num(n) {
  return Math.round(n).toLocaleString('en-US');
}
function loadPrices() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'prices.json'), 'utf8')); }
  catch { return {}; }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('spawner')
    .setDescription('Calculate spawner farm production')
    .addIntegerOption((o) =>
      o.setName('spawners').setDescription('How many spawners').setRequired(true)
        .setMinValue(1).setMaxValue(1000000))
    .addStringOption((o) =>
      o.setName('type').setDescription('Spawner type (skeleton by default)').addChoices(
        { name: 'Skeleton', value: 'skeleton' },
        { name: 'Cow', value: 'cow' },
        { name: 'Pig', value: 'pig' },
        { name: 'Creeper', value: 'creeper' },
        { name: 'Spider', value: 'spider' },
        { name: 'Blaze', value: 'blaze' },
        { name: 'Iron Golem', value: 'iron_golem' },
      )),

  async execute(interaction) {
    const x = interaction.options.getInteger('spawners');
    const type = interaction.options.getString('type') || 'skeleton';
    const sp = SPAWNERS[type];

    const stacks = Math.max(1, Math.round(x / STACK_SIZE));
    const each = x / stacks;
    const pileBase = baseRate(x);
    const splitBase = baseRate(each) * stacks; // == pileBase when stacks === 1
    const gain = pileBase > 0 ? splitBase / pileBase : 1;
    const prices = loadPrices();

    const titleEmoji = itemEmoji(`${type}_spawn_egg`) || itemEmoji(sp.drops[0].key) || '';
    const lines = [`### ${titleEmoji} ${sp.label} Spawner Production`, `**${num(x)}** spawners`, ''];

    let valueHour = 0;
    for (const d of sp.drops) {
      const ic = itemEmoji(d.key);
      const perMin = splitBase * d.mult;
      lines.push(`${ic ? `${ic} ` : ''}**${d.name}:**  \`${num(perMin)}\`/min  ·  \`${num(perMin * 60)}\`/hour`);
      const price = prices[d.priceKey];
      if (price) valueHour += perMin * 60 * price;
    }
    lines.push('');
    if (stacks > 1) {
      lines.push(`Split into **${stacks}** stacks of ~${num(each)} spawners (about **${gain.toFixed(1)}x** the one-pile rate).`);
    } else {
      lines.push('_One pile is fine at this size; splitting only helps past ~1,000 spawners._');
    }
    if (valueHour > 0) lines.push(`Value: **$${num(valueHour)}**/hour`);

    const embed = new EmbedBuilder()
      .setColor(config.colors.worth)
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'Spawner output is non-linear. Splitting into piles raises the total.' });
    return interaction.reply({ embeds: [embed] });
  },
};
