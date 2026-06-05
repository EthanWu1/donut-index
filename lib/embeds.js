const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const e = require('./emojis');
const { formatNumber, formatDuration, formatDelta } = require('./format');
const { itemEmoji } = require('./itemEmojis');

const C = config.colors;

function emojiUrl(emojiStr) {
  const m = /^<(a)?:\w+:(\d+)>$/.exec(emojiStr || '');
  if (!m) return null;
  return `https://cdn.discordapp.com/emojis/${m[2]}.${m[1] ? 'gif' : 'png'}?size=128`;
}

function statRow(emoji, label, current, prev) {
  let line = `${emoji} **${label}:** \`${formatNumber(current)}\``;
  if (prev !== null && prev !== undefined) {
    line += ` (${formatDelta(current, prev).text} / 24h)`;
  }
  return line;
}

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

function statsEmbed(ign, data) {
  const {
    stats, prev, online, location, discordId, playtimeSec, prevPlaytimeSec,
  } = data;
  const has = (k) => (prev ? prev[k] : null);

  const lines = [
    `### ${online ? e.online : e.offline}  ${ign}'s Statistics`,
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
    .setColor(online ? C.online : C.offline)
    .setThumbnail(`https://mc-heads.net/avatar/${encodeURIComponent(ign)}/100`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: statusText(ign, online, location) })
    .setTimestamp();
}

const LB_TITLES = {
  money: 'Top Money',
  shards: 'Top Shards',
  kills: 'Top Kills',
  deaths: 'Top Deaths',
  playtime: 'Top Playtime',
  placedblocks: 'Top Blocks Placed',
  brokenblocks: 'Top Blocks Broken',
  mobskilled: 'Top Mobs Killed',
  sell: 'Top Money Made',
  shop: 'Top Money Spent',
};
const LB_EMOJI = {
  money: e.balance,
  shards: e.shards,
  kills: e.kills,
  deaths: e.deaths,
  playtime: e.playtime,
  placedblocks: e.placed,
  brokenblocks: e.broken,
  mobskilled: e.mobs,
  sell: e.iron_nugget,
  shop: e.gold_nugget,
};

function leaderboardEmbed(type, page, rows, callerIgn) {
  const lines = rows.map((r, i) => {
    const rank = (page - 1) * 10 + i + 1;
    const me = callerIgn && r.name.toLowerCase() === callerIgn.toLowerCase();
    const nm = me ? `__**${r.name}**__` : r.name;
    return `**#${rank}**  ${nm}  -  \`${r.display}\``;
  });
  const embed = new EmbedBuilder()
    .setColor(C.leaderboard)
    .setDescription(`### ${LB_TITLES[type] || type}\n\n${lines.join('\n') || '_No entries._'}`)
    .setFooter({ text: `Page ${page}` })
    .setTimestamp();
  const url = emojiUrl(LB_EMOJI[type]);
  if (url) embed.setThumbnail(url);
  return embed;
}

function auctionEmbed(heading, items, footer) {
  const single = items.length > 0 && new Set(items.map((it) => it.name)).size === 1;
  const lines = items.map((it) => {
    const tl = it.timeLeft ? ` - ${formatDuration(Math.round(it.timeLeft / 1000))} left` : '';
    const amt = it.amount > 1 ? ` x${it.amount}` : '';
    const enchants = it.enchantText ? `\n_${it.enchantText}_` : '';
    if (single) {
      return `\`$${formatNumber(it.price)}\`${amt} - sold by **${it.seller}**${tl}${enchants}`;
    }
    const ic = itemEmoji(it.key);
    return `${ic ? `${ic} ` : ''}**${it.name}**${amt}\n`
      + `\`$${formatNumber(it.price)}\` - **${it.seller}**${tl}${enchants}`;
  });
  const embed = new EmbedBuilder()
    .setColor(C.auction)
    .setDescription(`### ${heading}\n\n${lines.join(single ? '\n' : '\n\n') || '_No listings found._'}`)
    .setFooter({ text: footer })
    .setTimestamp();
  if (single) {
    const url = emojiUrl(itemEmoji(items[0].key));
    if (url) embed.setThumbnail(url);
  }
  return embed;
}

function historyEmbed(ign, statLabel, rangeLabel) {
  return new EmbedBuilder()
    .setColor(C.history)
    .setThumbnail(`https://mc-heads.net/avatar/${encodeURIComponent(ign)}/100`)
    .setDescription(`### ${ign}'s Stats History\n\nViewing **${statLabel}** over **${rangeLabel}**.`)
    .setImage('attachment://history.png')
    .setFooter({ text: 'Pick a stat and range below' })
    .setTimestamp();
}

function errorEmbed(message) {
  return new EmbedBuilder().setColor(C.error).setDescription(`X ${message}`);
}

module.exports = {
  statsEmbed,
  leaderboardEmbed,
  auctionEmbed,
  historyEmbed,
  errorEmbed,
  emojiUrl,
  LB_EMOJI,
};
