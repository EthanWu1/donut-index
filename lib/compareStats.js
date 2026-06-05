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

function compactNumber(value) {
  const n = Number(value) || 0;
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const unit = abs >= 1e12 ? [1e12, 'T']
    : abs >= 1e9 ? [1e9, 'B']
      : abs >= 1e6 ? [1e6, 'M']
        : abs >= 1e3 ? [1e3, 'K'] : [1, ''];
  if (unit[0] === 1) return `${sign}${Math.trunc(abs).toLocaleString('en-US')}`;
  return `${sign}${(abs / unit[0]).toFixed(1).replace(/\.0$/, '')}${unit[1]}`;
}

function cardDisplay(value, def) {
  if (def.duration) return formatDuration(value);
  if (def.money) return `$${compactNumber(value)}`;
  return compactNumber(value);
}

function comparisonEntries(firstName, firstStats, secondName, secondStats, opts = {}) {
  const unit = opts.playtimeUnitSeconds || config.playtimeUnitSeconds;
  return STAT_DEFS.map((def) => {
    const a = valueFor(firstStats, def, unit);
    const b = valueFor(secondStats, def, unit);
    let winner = 'tie';
    if (a !== b) {
      const firstAhead = def.lowerBetter ? a < b : a > b;
      winner = firstAhead ? 'first' : 'second';
    }
    return {
      key: def.key,
      label: def.label,
      lowerBetter: Boolean(def.lowerBetter),
      firstName,
      secondName,
      firstValue: a,
      secondValue: b,
      firstLabel: cardDisplay(a, def),
      secondLabel: cardDisplay(b, def),
      diff: Math.abs(a - b),
      diffLabel: cardDisplay(Math.abs(a - b), def),
      winner,
    };
  });
}

function comparisonRows(firstName, firstStats, secondName, secondStats, opts = {}) {
  return comparisonEntries(firstName, firstStats, secondName, secondStats, opts).map((entry) => {
    const def = STAT_DEFS.find((d) => d.key === entry.key);
    const leader = entry.winner === 'first' ? firstName : entry.winner === 'second' ? secondName : 'Tie';
    const verdict = entry.winner === 'tie' ? 'Tie' : `${leader} by ${display(entry.diff, def)}`;
    return `**${entry.label}:** ${verdict} (${display(entry.firstValue, def)} vs ${display(entry.secondValue, def)})`;
  });
}

function compareEmbed(firstName, firstStats, secondName, secondStats) {
  return new EmbedBuilder()
    .setColor(config.colors.leaderboard)
    .setDescription(`### ${firstName} vs ${secondName}\n\n${comparisonRows(firstName, firstStats, secondName, secondStats).join('\n')}`)
    .setTimestamp();
}

module.exports = { comparisonRows, comparisonEntries, compareEmbed };
