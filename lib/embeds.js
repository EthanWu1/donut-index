const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const e = require('./emojis');
const { formatNumber, formatDuration, formatDelta } = require('./format');

const COLOR_ONLINE = 0x57f287;
const COLOR_OFFLINE = 0xed4245;

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
    `## ${online ? e.online : e.offline}  ${ign}'s Statistics`,
    '',
    statRow(e.balance, 'Balance', stats.money, has('money')),
    statRow(e.shards, 'Shards', stats.shards, has('shards')),
    statRow(e.kills, 'Kills', stats.kills, has('kills')),
    statRow(e.deaths, 'Deaths', stats.deaths, has('deaths')),
    durationRow(e.playtime, 'Playtime', playtimeSec, prevPlaytimeSec),
    statRow(e.placed, 'Blocks Placed', stats.placed, has('placed')),
    statRow(e.broken, 'Blocks Broken', stats.broken, has('broken')),
    statRow(e.mobs, 'Mobs Killed', stats.mobs, has('mobs')),
    statRow(e.gold_nugget, 'Money Spent (Shop)', stats.spent, has('spent')),
    statRow(e.iron_nugget, 'Money Made (Sell)', stats.made, has('made')),
  ];
  if (discordId) lines.push(`${e.discord} **Discord:** <@${discordId}>`);

  return new EmbedBuilder()
    .setColor(online ? COLOR_ONLINE : COLOR_OFFLINE)
    .setThumbnail(`https://mc-heads.net/avatar/${encodeURIComponent(ign)}/100`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: statusText(ign, online, location) })
    .setTimestamp();
}

const LB_TITLES = {
  money: 'Top Money', shards: 'Top Shards', kills: 'Top Kills', deaths: 'Top Deaths',
  playtime: 'Top Playtime', placedblocks: 'Top Blocks Placed', brokenblocks: 'Top Blocks Broken',
  mobskilled: 'Top Mobs Killed', sell: 'Top Money Made', shop: 'Top Money Spent',
};
const MEDALS = ['🥇', '🥈', '🥉'];

// rows: [{ name, display }] — display is the preformatted value.
function leaderboardEmbed(type, page, rows, callerIgn) {
  const lines = rows.map((r, i) => {
    const rank = (page - 1) * 10 + i + 1;
    const badge = rank <= 3 ? MEDALS[rank - 1] : `\`#${String(rank).padStart(2, '0')}\``;
    const me = callerIgn && r.name.toLowerCase() === callerIgn.toLowerCase();
    const name = me ? `__**${r.name}**__` : `**${r.name}**`;
    return `${badge} ${name} — \`${r.display}\``;
  });
  return new EmbedBuilder()
    .setColor(config.embedColor)
    .setDescription(`## ${LB_TITLES[type] || type}\n\n${lines.join('\n') || '_No entries._'}`)
    .setFooter({ text: `Page ${page} • Donut Index` })
    .setTimestamp();
}

// items: [{ name, amount, price, seller }]
function auctionEmbed(page, items, query) {
  const lines = items.map((it) =>
    `${e.shulker} **${it.name}**${it.amount > 1 ? ` ×${it.amount}` : ''}\n ${e.balance} \`${formatNumber(it.price)}\` • sold by **${it.seller}**`);
  const heading = `## Auction House${query ? ` — "${query}"` : ''}`;
  return new EmbedBuilder()
    .setColor(config.embedColor)
    .setDescription(`${heading}\n\n${lines.join('\n\n') || '_No listings found._'}`)
    .setFooter({ text: `Page ${page} • Donut Index` })
    .setTimestamp();
}

function historyEmbed(ign, statLabel, rangeLabel) {
  return new EmbedBuilder()
    .setColor(config.embedColor)
    .setThumbnail(`https://mc-heads.net/avatar/${encodeURIComponent(ign)}/100`)
    .setDescription(`## ${ign}'s Stats History\nViewing **${statLabel}** over **${rangeLabel}**.`)
    .setImage('attachment://history.png')
    .setFooter({ text: 'Pick a stat and range below • Donut Index' })
    .setTimestamp();
}

function errorEmbed(message) {
  return new EmbedBuilder().setColor(0xcc4444).setDescription(`❌ ${message}`);
}

module.exports = { statsEmbed, leaderboardEmbed, auctionEmbed, historyEmbed, errorEmbed };
