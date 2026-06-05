const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const { formatNumber, formatDuration } = require('./format');

const STAT_DEFS = [
  { key: 'money', label: 'Balance', money: true },
  { key: 'shards', label: 'Shards' },
  { key: 'kills', label: 'Kills' },
  { key: 'deaths', label: 'Deaths', lowerBetter: true },
  { key: 'playtime', label: 'Playtime', duration: true },
  { key: 'placed', label: 'Blocks Placed' },
  { key: 'broken', label: 'Blocks Broken' },
  { key: 'mobs', label: 'Mobs Killed' },
  { key: 'spent', label: 'Money Spent', money: true },
  { key: 'made', label: 'Money Made', money: true },
];

function valueFor(stat, def, unit) {
  const value = Number(stat[def.key]) || 0;
  return def.duration ? value * unit : value;
}

function display(value, def) {
  if (def.duration) return formatDuration(value);
  if (def.money) return `$${formatNumber(value)}`;
  return formatNumber(value);
}

function comparisonRows(firstName, firstStats, secondName, secondStats, opts = {}) {
  const unit = opts.playtimeUnitSeconds || config.playtimeUnitSeconds;
  return STAT_DEFS.map((def) => {
    const a = valueFor(firstStats, def, unit);
    const b = valueFor(secondStats, def, unit);
    let leader = 'Tie';
    let diffText = '0';
    if (a !== b) {
      const firstAhead = def.lowerBetter ? a < b : a > b;
      leader = firstAhead ? firstName : secondName;
      diffText = display(Math.abs(a - b), def);
    }
    const verdict = leader === 'Tie' ? 'Tie' : `${leader} by ${diffText}`;
    return `**${def.label}:** ${verdict} (${display(a, def)} vs ${display(b, def)})`;
  });
}

function compareEmbed(firstName, firstStats, secondName, secondStats) {
  return new EmbedBuilder()
    .setColor(config.colors.leaderboard)
    .setDescription(`### ${firstName} vs ${secondName}\n\n${comparisonRows(firstName, firstStats, secondName, secondStats).join('\n')}`)
    .setTimestamp();
}

module.exports = { comparisonRows, compareEmbed };
