const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const e = require('./emojis');
const { formatNumber, formatDuration, formatDelta, relativeTime } = require('./format');

// Renders "1.76M (-2.96B / 24h)" with a coloured arrow when a delta exists.
function valueWithDelta(current, prev, { duration = false } = {}) {
  const shown = duration ? formatDuration(current) : formatNumber(current);
  if (prev === null || prev === undefined) return `\`${shown}\``;
  const d = formatDelta(current, prev);
  const arrow = d.up ? '🟢' : d.down ? '🔴' : '⚪';
  return `\`${shown}\` ${arrow} \`${d.text} / 24h\``;
}

// stats: normalized object. prev: normalized object from a >=24h-old snapshot, or null.
// lookup: raw /lookup result. online: boolean.
function statsEmbed(ign, stats, prev, lookup, playtimeSeconds) {
  const p = prev || {};
  const has = (k) => (prev ? p[k] : null);
  const lastSeen = lookup && lookup.last_seen
    ? relativeTime(typeof lookup.last_seen === 'number' ? lookup.last_seen : Date.parse(lookup.last_seen))
    : 'unknown';
  const online = !!(lookup && (lookup.online || lookup.is_online));

  return new EmbedBuilder()
    .setColor(config.embedColor)
    .setAuthor({ name: `${ign}'s Statistics` })
    .setThumbnail(`https://mc-heads.net/avatar/${encodeURIComponent(ign)}/100`)
    .addFields(
      { name: `${e.balance} Balance`, value: valueWithDelta(stats.money, has('money')), inline: true },
      { name: `${e.shards} Shards`, value: valueWithDelta(stats.shards, has('shards')), inline: true },
      { name: `${e.kills} Kills`, value: valueWithDelta(stats.kills, has('kills')), inline: true },
      { name: `${e.deaths} Deaths`, value: valueWithDelta(stats.deaths, has('deaths')), inline: true },
      { name: `${e.mobs} Mobs Killed`, value: valueWithDelta(stats.mobs, has('mobs')), inline: true },
      { name: `${e.playtime} Playtime`, value: `\`${formatDuration(playtimeSeconds)}\``, inline: true },
      { name: `${e.placed} Blocks Placed`, value: valueWithDelta(stats.placed, has('placed')), inline: true },
      { name: `${e.broken} Blocks Broken`, value: valueWithDelta(stats.broken, has('broken')), inline: true },
      { name: '​', value: '​', inline: true },
      { name: `${e.spent} Money Spent (Shop)`, value: valueWithDelta(stats.spent, has('spent')), inline: true },
      { name: `${e.made} Money Made (Sell)`, value: valueWithDelta(stats.made, has('made')), inline: true },
      { name: '​', value: '​', inline: true },
    )
    .setFooter({ text: `Last seen ${lastSeen} • ${online ? 'Online' : 'Offline'} • ${config.brand}` })
    .setTimestamp();
}

function leaderboardEmbed(type, page, rows, callerIgn) {
  const lines = rows.map((r, i) => {
    const rank = (page - 1) * rows.length + i + 1;
    const mark = callerIgn && r.name && r.name.toLowerCase() === callerIgn.toLowerCase() ? '**' : '';
    return `\`#${rank}\` ${mark}${r.name}${mark} — \`${formatNumber(r.value)}\``;
  });
  return new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle(`${config.brand} — ${type} leaderboard`)
    .setDescription(lines.join('\n') || 'No entries.')
    .setFooter({ text: `Page ${page}` });
}

function auctionEmbed(page, items, query) {
  const lines = items.map((it) =>
    `**${it.name}**${it.amount > 1 ? ` ×${it.amount}` : ''} — \`${formatNumber(it.price)}\` • ${it.seller}`);
  return new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle(`${config.brand} — Auction House${query ? ` • "${query}"` : ''}`)
    .setDescription(lines.join('\n') || 'No listings on this page.')
    .setFooter({ text: `Page ${page}` });
}

function errorEmbed(message) {
  return new EmbedBuilder().setColor(0xcc4444).setDescription(`❌ ${message}`);
}

module.exports = { statsEmbed, leaderboardEmbed, auctionEmbed, errorEmbed, valueWithDelta };
