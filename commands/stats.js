const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const api = require('../lib/api');
const db = require('../lib/db');
const config = require('../config');
const emojis = require('../lib/emojis');
const { statsEmbed, errorEmbed } = require('../lib/embeds');

// Resolves the target IGN from the interaction options / linked account.
function resolveIgn(interaction) {
  const username = interaction.options.getString('username');
  if (username) return username.trim();
  const member = interaction.options.getUser('user');
  if (member) {
    const linked = db.getLink(member.id);
    if (!linked) return { error: `${member.username} has no linked DonutSMP account.` };
    return linked;
  }
  const own = db.getLink(interaction.user.id);
  if (!own) return { error: 'Provide a `username`, or `/link` your account first.' };
  return own;
}

async function buildStatsReply(ign) {
  const { stats } = await api.getStats(ign);
  db.trackPlayer(ign);
  db.addSnapshot(ign, stats);

  // /lookup only succeeds for online players (HTTP 500 when offline),
  // so a successful response is itself the "online" signal.
  let online = false;
  let location = null;
  try {
    const lookup = await api.getLookup(ign);
    online = true;
    location = lookup.location || lookup.world || lookup.server || lookup.area || null;
  } catch {
    online = false;
  }

  const prevRow = db.snapshotBefore(ign, Date.now() - 24 * 3600_000);
  const prev = prevRow && prevRow.ts <= Date.now() - 60_000 ? prevRow : null;
  const unit = config.playtimeUnitSeconds;

  const embed = statsEmbed(ign, {
    stats,
    prev,
    online,
    location,
    discordId: db.getDiscordIdByIgn(ign),
    playtimeSec: stats.playtime * unit,
    prevPlaytimeSec: prev ? prev.playtime * unit : null,
  });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`stats:history:${ign}:7d`)
      .setLabel('Stats History')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(emojis.playtime),
  );
  return { embeds: [embed], components: [row] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show DonutSMP stats for a player')
    .addStringOption((o) => o.setName('username').setDescription('Minecraft IGN').setMaxLength(16))
    .addUserOption((o) => o.setName('user').setDescription('A linked Discord user')),

  async execute(interaction) {
    await interaction.deferReply();
    const resolved = resolveIgn(interaction);
    if (resolved && resolved.error) {
      return interaction.editReply({ embeds: [errorEmbed(resolved.error)] });
    }
    try {
      const reply = await buildStatsReply(resolved);
      return interaction.editReply(reply);
    } catch (err) {
      if (err instanceof api.NotFoundError) {
        return interaction.editReply({ embeds: [errorEmbed(`No DonutSMP player named \`${resolved}\` was found.`)] });
      }
      if (err instanceof api.RateLimitedError) {
        return interaction.editReply({ embeds: [errorEmbed('DonutSMP API is rate-limited right now — try again shortly.')] });
      }
      throw err;
    }
  },

  // Button handler — `stats:history:<ign>:<range>`.
  async button(interaction) {
    const [, action, ign, arg] = interaction.customId.split(':');
    if (action === 'history') {
      await interaction.deferUpdate();
      const ranges = { '24h': 86400_000, '7d': 7 * 86400_000, '30d': 30 * 86400_000, all: Infinity };
      const range = ranges[arg] !== undefined ? arg : '7d';
      const since = range === 'all' ? 0 : Date.now() - ranges[range];
      const rows = db.snapshotsSince(ign, since);
      const points = rows.map((r) => ({ ts: r.ts, value: r.money }));
      const { renderBalanceChart } = require('../lib/chart');
      const png = renderBalanceChart(points, `${ign} — Balance (${range})`, true);
      const { AttachmentBuilder } = require('discord.js');
      const file = new AttachmentBuilder(png, { name: 'history.png' });

      const rangeRow = new ActionRowBuilder().addComponents(
        ...['24h', '7d', '30d', 'all'].map((r) =>
          new ButtonBuilder()
            .setCustomId(`stats:history:${ign}:${r}`)
            .setLabel(r)
            .setStyle(r === range ? ButtonStyle.Primary : ButtonStyle.Secondary)),
      );
      return interaction.editReply({ files: [file], components: [rangeRow] });
    }
  },

  _buildStatsReply: buildStatsReply,
};
