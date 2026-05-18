const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('node:path');
const fs = require('node:fs');
const config = require('../config');
const emojis = require('../lib/emojis');

// Production curves: primary drop per minute for x spawners in one pile,
// modelled as  y = a * e^(b*x + c) + d.  Add types as data is gathered.
const CURVES = {
  skeleton: {
    label: 'Skeleton',
    drop: 'bones',
    priceKey: 'bone',
    a: -0.39567, b: -0.00134606, c: 8.24358, d: 1505.35,
  },
};

// Recommended pile size for splitting (midpoint of the 500-1000 guidance).
const STACK_SIZE = 750;

function rate(curve, x) {
  return Math.max(0, curve.a * Math.exp(curve.b * x + curve.c) + curve.d);
}

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
      o.setName('spawners').setDescription('How many spawners').setRequired(true).setMinValue(1).setMaxValue(1000000))
    .addStringOption((o) =>
      o.setName('type').setDescription('Spawner type (skeleton by default)')
        .addChoices({ name: 'Skeleton', value: 'skeleton' })),

  async execute(interaction) {
    const x = interaction.options.getInteger('spawners');
    const type = interaction.options.getString('type') || 'skeleton';
    const curve = CURVES[type];

    const pileMin = rate(curve, x);
    const stacks = Math.max(1, Math.round(x / STACK_SIZE));
    const each = x / stacks;
    const splitMin = rate(curve, each) * stacks;
    const splitHour = splitMin * 60;
    const gain = pileMin > 0 ? splitMin / pileMin : 1;

    const lines = [
      `### ${emojis.deaths} ${curve.label} Spawner Production`,
      `**${num(x)}** spawners`,
      '',
      '**As one pile**',
      `\`${num(pileMin)}\` ${curve.drop}/min  ·  \`${num(pileMin * 60)}\` ${curve.drop}/hour`,
    ];

    if (stacks > 1) {
      lines.push(
        '',
        `**Split into ${stacks} stacks of ~${num(each)}** (recommended)`,
        `\`${num(splitMin)}\` ${curve.drop}/min  ·  \`${num(splitHour)}\` ${curve.drop}/hour`,
        `That is **${gain.toFixed(1)}x** the one-pile rate.`,
      );
    } else {
      lines.push('', '_With this few spawners, one pile is already fine._');
    }

    const best = stacks > 1 ? splitMin : pileMin;
    lines.push('', `Efficiency: \`${(best / x).toFixed(2)}\` ${curve.drop}/min per spawner`);

    const price = loadPrices()[curve.priceKey];
    if (price !== undefined) {
      lines.push(`Value: \`$${num(best * 60 * price)}\`/hour at \`$${num(price)}\` each`);
    }

    const embed = new EmbedBuilder()
      .setColor(config.colors.worth)
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'Skeleton spawners produce bones at a non-linear rate' });
    return interaction.reply({ embeds: [embed] });
  },
};
