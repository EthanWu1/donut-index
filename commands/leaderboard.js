const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const api = require('../lib/api');
const db = require('../lib/db');
const { leaderboardEmbed, errorEmbed } = require('../lib/embeds');

const TYPES = ['money', 'shards', 'kills', 'deaths', 'playtime', 'placedblocks', 'brokenblocks', 'mobskilled', 'sell', 'shop'];

function normalizeRow(row) {
  const name = row.name || row.username || row.player || row.ign || 'unknown';
  const value = Number(row.value ?? row.amount ?? row.count ?? row.score ?? 0) || 0;
  return { name, value };
}

async function buildPage(type, page, callerIgn) {
  const raw = await api.getLeaderboard(type, page);
  const list = Array.isArray(raw) ? raw : raw.leaderboard || raw.entries || raw.players || [];
  const rows = list.map(normalizeRow);
  const embed = leaderboardEmbed(type, page, rows, callerIgn);
  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`leaderboard:${type}:${page - 1}`).setLabel('Prev').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(`leaderboard:${type}:${page + 1}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(rows.length === 0),
  );
  return { embeds: [embed], components: [nav] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show a DonutSMP leaderboard')
    .addStringOption((o) =>
      o.setName('type').setDescription('Leaderboard type').setRequired(true)
        .addChoices(...TYPES.map((t) => ({ name: t, value: t }))))
    .addIntegerOption((o) => o.setName('page').setDescription('Page number').setMinValue(1)),

  async execute(interaction) {
    await interaction.deferReply();
    const type = interaction.options.getString('type');
    const page = interaction.options.getInteger('page') || 1;
    const callerIgn = db.getLink(interaction.user.id);
    try {
      return interaction.editReply(await buildPage(type, page, callerIgn));
    } catch (err) {
      if (err instanceof api.RateLimitedError) {
        return interaction.editReply({ embeds: [errorEmbed('DonutSMP API is rate-limited — try again shortly.')] });
      }
      throw err;
    }
  },

  async button(interaction) {
    const [, type, pageStr] = interaction.customId.split(':');
    const page = Math.max(1, Number(pageStr) || 1);
    await interaction.deferUpdate();
    const callerIgn = db.getLink(interaction.user.id);
    return interaction.editReply(await buildPage(type, page, callerIgn));
  },
};
