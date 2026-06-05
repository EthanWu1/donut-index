const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const LINES = [
  '### Donut Index',
  '',
  '_DonutSMP stats, leaderboards, live auction data, and build tools._',
  '',
  '**Player**',
  '`/compare` - compare two players side by side',
  '`/stats` - player stats with 24h changes and a history chart',
  '`/rank` - a player\'s placement on every leaderboard',
  '`/link` - link your Discord account to your IGN',
  '`/unlink` - remove that link',
  '`/pay` - watch the API for a payment between two players',
  '',
  '**Leaderboards & Market**',
  '`/leaderboard` - top players for any stat',
  '`/ah` - browse or search the auction house',
  '`/price` - average real sold price of an item',
  '`/history` - auction-house price chart for an item',
  '`/worth` - shop sell value of an item',
  '',
  '**Build & Schematics**',
  '`/schematics` - browse the schematic library',
  '`/render` - render a `.litematic` file to an image',
  '`/holoprint` - turn a `.litematic` into a HoloPrint pack',
  '`/spawner` - spawner farm production calculator',
  '',
  '**Prefix**',
  'Most read-only tools also work with `!`, like `!stats Player`, `!ah fortune`, and `!history stone`.',
].join('\n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show what Donut Index can do'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0xe8a657)
      .setThumbnail(interaction.client.user.displayAvatarURL({ size: 128 }))
      .setDescription(LINES)
      .setFooter({ text: 'Donut Index' });
    return interaction.reply({ embeds: [embed] });
  },
};
