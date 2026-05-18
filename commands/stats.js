const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, AttachmentBuilder,
} = require('discord.js');
const api = require('../lib/api');
const db = require('../lib/db');
const config = require('../config');
const { statsEmbed, historyEmbed, errorEmbed } = require('../lib/embeds');
const { renderChart } = require('../lib/chart');

// Chartable stats — key matches both the snapshot column and the API field.
// Unicode emoji only — custom emoji are rejected by Discord on select menus.
const STATS = [
  { key: 'money', label: 'Balance', emoji: '💰' },
  { key: 'shards', label: 'Shards', emoji: '🔷' },
  { key: 'kills', label: 'Kills', emoji: '⚔️' },
  { key: 'deaths', label: 'Deaths', emoji: '☠️' },
  { key: 'playtime', label: 'Playtime', emoji: '🕒' },
  { key: 'placed', label: 'Blocks Placed', emoji: '🧱' },
  { key: 'broken', label: 'Blocks Broken', emoji: '⛏️' },
  { key: 'mobs', label: 'Mobs Killed', emoji: '🧟' },
  { key: 'spent', label: 'Money Spent', emoji: '🛒' },
  { key: 'made', label: 'Money Made', emoji: '💵' },
];
const RANGES = {
  '24h': { ms: 86400_000, label: 'Last 24 hours' },
  '7d': { ms: 7 * 86400_000, label: 'Last 7 days' },
  '30d': { ms: 30 * 86400_000, label: 'Last 30 days' },
  all: { ms: Infinity, label: 'All Time' },
};

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
      .setCustomId(`stats:history:${ign}`)
      .setLabel('Stats History')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🕒'),
  );
  return { embeds: [embed], components: [row], files: [] };
}

// Builds the Stats History view: chart image + stat selector + range + back.
function buildHistoryView(ign, statKey, range) {
  const stat = STATS.find((s) => s.key === statKey) || STATS[0];
  const rangeDef = RANGES[range] || RANGES['7d'];
  const since = rangeDef.ms === Infinity ? 0 : Date.now() - rangeDef.ms;
  const rows = db.snapshotsSince(ign, since);
  const isPlaytime = stat.key === 'playtime';

  const points = rows.map((r) => ({
    ts: r.ts,
    value: isPlaytime ? (r.playtime * config.playtimeUnitSeconds) / 3600 : r[stat.key],
  }));
  const png = renderChart(points);
  const file = new AttachmentBuilder(png, { name: 'history.png' });
  const embed = historyEmbed(ign, stat.label, rangeDef.label);

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`stats:hstat:${ign}:${range}`)
      .setPlaceholder('Select a stat to chart')
      .addOptions(STATS.map((o) => ({
        label: o.label,
        value: o.key,
        emoji: o.emoji,
        default: o.key === stat.key,
      }))),
  );
  const rangeRow = new ActionRowBuilder().addComponents(
    ...Object.keys(RANGES).map((r) =>
      new ButtonBuilder()
        .setCustomId(`stats:hrange:${ign}:${stat.key}:${r}`)
        .setLabel(r === 'all' ? 'All Time' : r)
        .setStyle(r === range ? ButtonStyle.Primary : ButtonStyle.Secondary)),
  );
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`stats:hback:${ign}`)
      .setLabel('Back to Stats')
      .setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], files: [file], components: [selectRow, rangeRow, backRow] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show DonutSMP stats for a player')
    .addStringOption((o) =>
      o.setName('username').setDescription('Minecraft IGN').setMaxLength(16).setAutocomplete(true))
    .addUserOption((o) => o.setName('user').setDescription('A linked Discord user')),

  async autocomplete(interaction) {
    const q = interaction.options.getFocused().toLowerCase();
    const out = db.allTracked().filter((i) => i.toLowerCase().includes(q)).slice(0, 25);
    await interaction.respond(out.map((i) => ({ name: i, value: i })));
  },

  async execute(interaction) {
    await interaction.deferReply();
    const resolved = resolveIgn(interaction);
    if (resolved && resolved.error) {
      return interaction.editReply({ embeds: [errorEmbed(resolved.error)] });
    }
    try {
      return interaction.editReply(await buildStatsReply(resolved));
    } catch (err) {
      if (err instanceof api.NotFoundError) {
        return interaction.editReply({ embeds: [errorEmbed(`No DonutSMP player named \`${resolved}\` was found.`)] });
      }
      if (err instanceof api.RateLimitedError) {
        return interaction.editReply({ embeds: [errorEmbed('DonutSMP API is rate-limited right now. Try again shortly.')] });
      }
      throw err;
    }
  },

  // Buttons: stats:history:<ign> | stats:hrange:<ign>:<stat>:<range> | stats:hback:<ign>
  async button(interaction) {
    const p = interaction.customId.split(':');
    const action = p[1];
    const ign = p[2];
    await interaction.deferUpdate();

    if (action === 'history') {
      return interaction.editReply(buildHistoryView(ign, 'money', '7d'));
    }
    if (action === 'hrange') {
      return interaction.editReply(buildHistoryView(ign, p[3], p[4]));
    }
    if (action === 'hback') {
      return interaction.editReply(await buildStatsReply(ign));
    }
  },

  // Select menu: stats:hstat:<ign>:<range> — chosen value is the stat key.
  async selectMenu(interaction) {
    const p = interaction.customId.split(':');
    if (p[1] === 'hstat') {
      await interaction.deferUpdate();
      return interaction.editReply(buildHistoryView(p[2], interaction.values[0] || 'money', p[3]));
    }
  },
};
