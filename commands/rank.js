const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../lib/db');
const config = require('../config');
const { getLeaderboardIndex } = require('../jobs/leaderboard');
const { errorEmbed, LB_EMOJI } = require('../lib/embeds');

const ORDER = [
  'money', 'shards', 'kills', 'deaths', 'playtime',
  'placedblocks', 'brokenblocks', 'mobskilled', 'sell', 'shop',
];
const TITLES = {
  money: 'Money', shards: 'Shards', kills: 'Kills', deaths: 'Deaths', playtime: 'Playtime',
  placedblocks: 'Blocks Placed', brokenblocks: 'Blocks Broken', mobskilled: 'Mobs Killed',
  sell: 'Money Made', shop: 'Money Spent',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription("Find a player's position on every leaderboard")
    .addStringOption((o) =>
      o.setName('username').setDescription('Minecraft IGN').setMaxLength(16).setAutocomplete(true))
    .addUserOption((o) => o.setName('user').setDescription('A linked Discord user')),

  async autocomplete(interaction) {
    const q = interaction.options.getFocused().toLowerCase();
    const out = db.allTracked().filter((i) => i.toLowerCase().includes(q)).slice(0, 25);
    await interaction.respond(out.map((i) => ({ name: i, value: i })));
  },

  async execute(interaction) {
    let ign = interaction.options.getString('username');
    if (!ign) {
      const member = interaction.options.getUser('user');
      ign = member ? db.getLink(member.id) : db.getLink(interaction.user.id);
    }
    if (!ign) {
      return interaction.reply({ embeds: [errorEmbed('Provide a `username`, or `/link` your account first.')] });
    }
    ign = ign.trim();

    const { boards, updatedAt } = getLeaderboardIndex();
    if (updatedAt === 0) {
      return interaction.reply({ embeds: [errorEmbed('Leaderboards are still being indexed. Try again shortly.')] });
    }

    const low = ign.toLowerCase();
    const lines = [];
    for (const type of ORDER) {
      const idx = (boards[type] || []).indexOf(low);
      if (idx >= 0) {
        lines.push(`${LB_EMOJI[type] || ''} **${TITLES[type]}:** #${idx + 1}`);
      }
    }
    const ranked = lines.length;
    const body = ranked ? lines.join('\n') : '_Not ranked on any leaderboard._';

    const embed = new EmbedBuilder()
      .setColor(config.colors.leaderboard)
      .setThumbnail(`https://mc-heads.net/avatar/${encodeURIComponent(ign)}/100`)
      .setDescription(`### ${ign}'s Leaderboard Ranks\n\n${body}`)
      .setFooter({ text: `Ranked on ${ranked}/${ORDER.length} leaderboards` })
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  },
};
