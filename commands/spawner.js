const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const config = require('../config');
const { itemEmoji } = require('../lib/itemEmojis');

// Skeleton bone curve (one pile of x spawners): y = a*e^(b*x + c) + d.
const BASE = { a: -0.39567, b: -0.00134606, c: 8.24358, d: 1505.35 };
function baseRate(x) {
  return Math.max(0, BASE.a * Math.exp(BASE.b * x + BASE.c) + BASE.d);
}

const STACK_SIZE = 750;
const STEPS = [-100, -10, 10, 100];
const MIN = 1;
const MAX = 1000000;

// Each spawner's drops, as a multiplier on the base bone curve.
const SPAWNERS = {
  skeleton: { label: 'Skeleton', drops: [
    { name: 'Bones', key: 'bone', mult: 1 },
    { name: 'Arrows', key: 'arrow', mult: 0.5 },
  ] },
  cow: { label: 'Cow', drops: [{ name: 'Raw Beef', key: 'beef', mult: 1.5 }] },
  pig: { label: 'Pig', drops: [{ name: 'Raw Porkchop', key: 'porkchop', mult: 1.5 }] },
  creeper: { label: 'Creeper', drops: [{ name: 'Gunpowder', key: 'gunpowder', mult: 2 }] },
  spider: { label: 'Spider', drops: [
    { name: 'String', key: 'string', mult: 3 },
    { name: 'Spider Eyes', key: 'spider_eye', mult: 1 },
  ] },
  blaze: { label: 'Blaze', drops: [{ name: 'Blaze Powder', key: 'blaze_powder', mult: 5.5 }] },
  iron_golem: { label: 'Iron Golem', drops: [{ name: 'Iron Ingots', key: 'iron_ingot', mult: 1 }] },
};
const TYPE_KEYS = Object.keys(SPAWNERS);

function num(n) { return Math.round(n).toLocaleString('en-US'); }
function clamp(n) { return Math.min(MAX, Math.max(MIN, Math.round(Number(n) || MIN))); }

// Builds the embed + interactive controls for a type/count. `pilesRaw` of 0
// (or blank) auto-splits by STACK_SIZE; a positive value pins the pile count.
function view(type, countRaw, pilesRaw) {
  const t = SPAWNERS[type] ? type : 'skeleton';
  const sp = SPAWNERS[t];
  const x = clamp(countRaw);

  const reqPiles = Math.max(0, Math.round(Number(pilesRaw) || 0));
  const autoPiles = Math.max(1, Math.round(x / STACK_SIZE));
  const piles = reqPiles > 0 ? Math.min(x, reqPiles) : autoPiles;
  const each = x / piles;
  const pileBase = baseRate(x);
  const splitBase = baseRate(each) * piles;
  const gain = pileBase > 0 ? splitBase / pileBase : 1;

  const titleEmoji = itemEmoji(`${t}_spawn_egg`) || itemEmoji(sp.drops[0].key) || '';
  const lines = [`### ${titleEmoji} ${sp.label} Spawner Production`, '', `**${num(x)}** spawners`, ''];
  for (const d of sp.drops) {
    const ic = itemEmoji(d.key);
    const perMin = splitBase * d.mult;
    lines.push(`${ic ? `${ic} ` : ''}**${d.name}:**  \`${num(perMin)}\`/min  ·  \`${num(perMin * 60)}\`/hour`);
  }
  lines.push('');
  if (piles > 1) {
    lines.push(`Split into **${num(piles)}** piles of ~${num(each)} spawners`
      + ` (about **${gain.toFixed(1)}x** the one-pile rate)`
      + `${reqPiles > 0 ? ' — pile count set manually' : ' — auto-split'}.`);
  } else {
    lines.push('_One pile is fine at this size; splitting only helps past ~1,000 spawners._');
  }

  const embed = new EmbedBuilder()
    .setColor(config.colors.worth)
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'Spawner output is non-linear. Splitting into piles raises the total.' });

  const typeRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`spawner:t:${x}:${reqPiles}`)
      .setPlaceholder('Switch spawner type')
      .addOptions(TYPE_KEYS.map((k) => ({ label: SPAWNERS[k].label, value: k, default: k === t }))),
  );
  const stepRow = new ActionRowBuilder().addComponents(
    ...STEPS.map((s) =>
      new ButtonBuilder()
        .setCustomId(`spawner:a:${t}:${x}:${reqPiles}:${s}`)
        .setLabel(`${s > 0 ? '+' : '−'}${num(Math.abs(s))}`)
        .setStyle(ButtonStyle.Secondary)),
    new ButtonBuilder()
      .setCustomId(`spawner:s:${t}:${x}:${reqPiles}`)
      .setLabel('Set')
      .setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [typeRow, stepRow] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('spawner')
    .setDescription('Calculate spawner farm production')
    .addIntegerOption((o) =>
      o.setName('spawners').setDescription('How many spawners (default 1000)').setMinValue(1).setMaxValue(MAX))
    .addStringOption((o) =>
      o.setName('type').setDescription('Spawner type (skeleton by default)')
        .addChoices(...TYPE_KEYS.map((k) => ({ name: SPAWNERS[k].label, value: k })))),

  async execute(interaction) {
    const count = interaction.options.getInteger('spawners') || 1000;
    const type = interaction.options.getString('type') || 'skeleton';
    return interaction.reply(view(type, count, 0));
  },

  // Buttons:
  //   spawner:a:<type>:<count>:<piles>:<delta>  — step the spawner count
  //   spawner:s:<type>:<count>:<piles>          — open the Set modal
  async button(interaction) {
    const p = interaction.customId.split(':');
    if (p[1] === 'a') {
      return interaction.update(view(p[2], clamp(Number(p[3]) + Number(p[5])), p[4]));
    }
    if (p[1] === 's') {
      const reqPiles = Number(p[4]) || 0;
      const countInput = new TextInputBuilder()
        .setCustomId('count')
        .setLabel('Number of spawners')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(7)
        .setValue(String(p[3] || 1000));
      const pilesInput = new TextInputBuilder()
        .setCustomId('piles')
        .setLabel('Number of piles')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(7);
      if (reqPiles > 0) pilesInput.setValue(String(reqPiles));
      const modal = new ModalBuilder()
        .setCustomId(`spawner:m:${p[2]}`)
        .setTitle('Set spawners and piles')
        .addComponents(
          new ActionRowBuilder().addComponents(countInput),
          new ActionRowBuilder().addComponents(pilesInput),
        );
      return interaction.showModal(modal);
    }
    return undefined;
  },

  // Select menu: spawner:t:<count>:<piles> — chosen value is the new type.
  async selectMenu(interaction) {
    const p = interaction.customId.split(':');
    if (p[1] === 't') {
      return interaction.update(view(interaction.values[0], Number(p[2]), p[3]));
    }
    return undefined;
  },

  // Modal: spawner:m:<type> — count (required) + piles (blank = auto-split).
  async modal(interaction) {
    const p = interaction.customId.split(':');
    const count = clamp(interaction.fields.getTextInputValue('count').replace(/[^0-9]/g, ''));
    const piles = interaction.fields.getTextInputValue('piles').replace(/[^0-9]/g, '');
    return interaction.update(view(p[2], count, piles || 0));
  },
};
