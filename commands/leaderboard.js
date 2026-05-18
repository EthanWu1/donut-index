const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} = require('discord.js');
const api = require('../lib/api');
const db = require('../lib/db');
const config = require('../config');
const emojis = require('../lib/emojis');
const { formatNumber, formatDuration } = require('../lib/format');
const { leaderboardEmbed, errorEmbed } = require('../lib/embeds');

const TYPES = [
  { value: 'money', label: 'Money', emoji: 'balance' },
  { value: 'shards', label: 'Shards', emoji: 'shards' },
  { value: 'kills', label: 'Kills', emoji: 'kills' },
  { value: 'deaths', label: 'Deaths', emoji: 'deaths' },
  { value: 'playtime', label: 'Playtime', emoji: 'playtime' },
  { value: 'placedblocks', label: 'Blocks Placed', emoji: 'placed' },
  { value: 'brokenblocks', label: 'Blocks Broken', emoji: 'broken' },
  { value: 'mobskilled', label: 'Mobs Killed', emoji: 'mobs' },
  { value: 'sell', label: 'Money Made', emoji: 'iron_nugget' },
  { value: 'shop', label: 'Money Spent', emoji: 'gold_nugget' },
];

// Turns "<:name:id>" / "<a:name:id>" into a select-menu emoji object.
function parseEmoji(str) {
  const m = /^<(a)?:(\w+):(\d+)>$/.exec(str || '');
  return m ? { id: m[3], name: m[2], animated: !!m[1] } : undefined;
}

function normalizeRow(row) {
  const name = row.name || row.username || row.player || row.ign || 'unknown';
  const value = Number(row.value ?? row.amount ?? row.count ?? row.score ?? 0) || 0;
  return { name: String(name), value };
}

function displayValue(type, value) {
  if (type === 'playtime') return formatDuration(value * config.playtimeUnitSeconds);
  return formatNumber(value);
}

async function buildPage(type, page, callerIgn) {
  const raw = await api.getLeaderboard(type, page);
  const list = Array.isArray(raw) ? raw : raw.leaderboard || raw.entries || raw.players || [];
  const rows = list.slice(0, 10).map(normalizeRow)
    .map((r) => ({ name: r.name, display: displayValue(type, r.value) }));
  const embed = leaderboardEmbed(type, page, rows, callerIgn);

  const typeRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`leaderboard:type:${page}`)
      .setPlaceholder('Switch leaderboard')
      .addOptions(TYPES.map((t) => ({
        label: t.label,
        value: t.value,
        emoji: parseEmoji(emojis[t.emoji]),
        default: t.value === type,
      }))),
  );
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`leaderboard:page:${type}:${page - 1}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(`leaderboard:page:${type}:${page + 1}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(rows.length === 0),
  );
  return { embeds: [embed], components: [typeRow, navRow] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show a DonutSMP leaderboard')
    .addStringOption((o) =>
      o.setName('type').setDescription('Leaderboard type').setRequired(true)
        .addChoices(...TYPES.map((t) => ({ name: t.label, value: t.value })))),

  async execute(interaction) {
    await interaction.deferReply();
    const type = interaction.options.getString('type');
    const callerIgn = db.getLink(interaction.user.id);
    try {
      return interaction.editReply(await buildPage(type, 1, callerIgn));
    } catch (err) {
      if (err instanceof api.RateLimitedError) {
        return interaction.editReply({ embeds: [errorEmbed('DonutSMP API is rate-limited. Try again shortly.')] });
      }
      throw err;
    }
  },

  // Button: leaderboard:page:<type>:<page>
  async button(interaction) {
    const [, , type, pageStr] = interaction.customId.split(':');
    const page = Math.max(1, Number(pageStr) || 1);
    await interaction.deferUpdate();
    return interaction.editReply(await buildPage(type, page, db.getLink(interaction.user.id)));
  },

  // Select menu: leaderboard:type:<page> — chosen value is the new type.
  async selectMenu(interaction) {
    const type = interaction.values[0];
    await interaction.deferUpdate();
    return interaction.editReply(await buildPage(type, 1, db.getLink(interaction.user.id)));
  },
};
