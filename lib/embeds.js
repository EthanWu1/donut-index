const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const e = require('./emojis');
const { formatNumber, formatDuration, formatDelta } = require('./format');

// One stat line: "<emoji> **Label:** `value` (+delta / 24h)".
function statRow(emoji, label, current, prev) {
  let line = `${emoji} **${label}:** \`${formatNumber(current)}\``;
  if (prev !== null && prev !== undefined) {
    line += ` (${formatDelta(current, prev).text} / 24h)`;
  }
  return line;
}

// Playtime line: values are seconds; the delta is shown as a duration.
function durationRow(emoji, label, currentSec, prevSec) {
  let line = `${emoji} **${label}:** \`${formatDuration(currentSec)}\``;
  if (prevSec !== null && prevSec !== undefined) {
    const diff = Math.round(currentSec - prevSec);
    line += ` (${diff < 0 ? '-' : '+'}${formatDuration(Math.abs(diff))})`;
  }
  return line;
}

function statusText(ign, online, location) {
  if (!online) return `${ign} is currently offline!`;
  return `${ign} is currently ${location ? `in the ${location}` : 'online'}!`;
}

// data: { stats, prev, online, location, discordId, playtimeSec, prevPlaytimeSec }
function statsEmbed(ign, data) {
  const { stats, prev, online, location, discordId, playtimeSec, prevPlaytimeSec } = data;
  const has = (k) => (prev ? prev[k] : null);

  const lines = [
    `${online ? e.online : e.offline} **${online ? (location ? `In the ${location}` : 'Online') : 'Offline'}**`,
    '',
    statRow(e.balance, 'Balance', stats.money, has('money')),
    statRow(e.shards, 'Shards', stats.shards, has('shards')),
    statRow(e.kills, 'Kills', stats.kills, has('kills')),
    statRow(e.deaths, 'Deaths', stats.deaths, has('deaths')),
    durationRow(e.playtime, 'Playtime', playtimeSec, prevPlaytimeSec),
    statRow(e.placed, 'Blocks Placed', stats.placed, has('placed')),
    statRow(e.broken, 'Blocks Broken', stats.broken, has('broken')),
    statRow(e.mobs, 'Mobs Killed', stats.mobs, has('mobs')),
    statRow(e.spent, 'Money Spent (Shop)', stats.spent, has('spent')),
    statRow(e.made, 'Money Made (Sell)', stats.made, has('made')),
  ];
  if (discordId) lines.push(`${e.discord} **Discord:** <@${discordId}>`);

  return new EmbedBuilder()
    .setColor(config.embedColor)
    .setAuthor({ name: `${ign}'s Statistics` })
    .setThumbnail(`https://mc-heads.net/avatar/${encodeURIComponent(ign)}/100`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: statusText(ign, online, location) })
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

module.exports = { statsEmbed, leaderboardEmbed, auctionEmbed, errorEmbed };
