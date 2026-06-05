const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const api = require('../lib/api');
const db = require('../lib/db');
const config = require('../config');
const { errorEmbed } = require('../lib/embeds');
const { renderProfileCard } = require('../lib/profileCard');

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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Show a DonutSMP profile card')
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
      const { stats } = await api.getStats(resolved);
      db.trackPlayer(resolved);
      db.addSnapshot(resolved, stats);

      let online = false;
      let location = null;
      try {
        const lookup = await api.getLookup(resolved);
        online = true;
        location = lookup.location || lookup.world || lookup.server || lookup.area || null;
      } catch {
        online = false;
      }

      const png = renderProfileCard(resolved, {
        stats,
        online,
        location,
        playtimeSec: stats.playtime * config.playtimeUnitSeconds,
      });
      const file = new AttachmentBuilder(png, { name: 'profile.png' });
      const embed = new EmbedBuilder()
        .setColor(online ? config.colors.online : config.colors.offline)
        .setImage('attachment://profile.png')
        .setTimestamp();
      return interaction.editReply({ embeds: [embed], files: [file] });
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
};
