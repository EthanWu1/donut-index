const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const api = require('../lib/api');
const db = require('../lib/db');
const config = require('../config');
const { errorEmbed } = require('../lib/embeds');

const TARGET = config.linkVerifyTarget;

// Pending verifications live in the `pending_links` table (lib/db.js) so an
// in-progress verification survives a bot restart. Expired rows are swept by
// the pay job; the button below also rejects them lazily.

function checkRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('link:check').setLabel('Check payment').setStyle(ButtonStyle.Success),
  );
}

function pendingEmbed(ign, code, note) {
  const lines = [
    `### Verify ${ign}`,
    '',
    `To prove you own **${ign}**, pay this exact amount in-game:`,
    '',
    `> \`/pay ${TARGET} ${code}\``,
    '',
    `Send **exactly** \`$${code}\` to **${TARGET}**, then press **Check payment**.`,
  ];
  if (note) lines.push('', note);
  return new EmbedBuilder()
    .setColor(config.colors.leaderboard)
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'This code expires in 15 minutes.' });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Discord account to a DonutSMP username')
    .addStringOption((o) =>
      o.setName('username').setDescription('Your Minecraft IGN').setRequired(true).setMaxLength(16)),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ign = interaction.options.getString('username').trim();

    // A live balance read both validates the IGN (404 -> rejected) and gives
    // the baseline the payment check measures against.
    let userBaseline;
    try {
      userBaseline = await api.getBalance(ign);
    } catch (err) {
      if (err instanceof api.NotFoundError) {
        return interaction.editReply({ embeds: [errorEmbed(`No DonutSMP player named \`${ign}\` was found.`)] });
      }
      return interaction.editReply({ embeds: [errorEmbed('Could not reach the DonutSMP API. Try again in a moment.')] });
    }

    let targetBaseline;
    try {
      targetBaseline = await api.getBalance(TARGET);
    } catch {
      return interaction.editReply({ embeds: [errorEmbed('Could not reach the DonutSMP API. Try again in a moment.')] });
    }

    const code = Math.floor(1000 + Math.random() * 9000);
    db.setPendingLink(interaction.user.id, {
      ign, code, userBaseline, targetBaseline,
      expiresAt: Date.now() + config.linkVerifyTimeoutMs,
    });

    return interaction.editReply({ embeds: [pendingEmbed(ign, code)], components: [checkRow()] });
  },

  // Button: link:check — verifies the code payment moved between the accounts.
  async button(interaction) {
    if (interaction.customId.split(':')[1] !== 'check') return;

    const p = db.getPendingLink(interaction.user.id);
    if (!p || Date.now() > p.expiresAt) {
      db.deletePendingLink(interaction.user.id);
      return interaction.update({
        embeds: [errorEmbed('This verification expired. Run `/link` again.')],
        components: [],
      });
    }

    await interaction.deferUpdate();
    let userNow;
    let targetNow;
    try {
      userNow = await api.getBalance(p.ign);
      targetNow = await api.getBalance(TARGET);
    } catch {
      return interaction.editReply({
        embeds: [pendingEmbed(p.ign, p.code, 'Could not reach the DonutSMP API. Try again in a moment.')],
        components: [checkRow()],
      });
    }

    const deducted = p.userBaseline - userNow;
    const received = targetNow - p.targetBaseline;
    if (deducted === p.code && received === p.code) {
      db.deletePendingLink(interaction.user.id);
      db.setLink(interaction.user.id, p.ign);
      db.trackPlayer(p.ign);
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(config.colors.online)
          .setDescription(`### Linked to ${p.ign}\n\nOwnership verified by payment. \`/stats\` with no arguments now uses this account.`)],
        components: [],
      });
    }

    return interaction.editReply({
      embeds: [pendingEmbed(p.ign, p.code,
        `Payment of \`$${p.code}\` not detected yet. Pay **exactly** \`${p.code}\` to **${TARGET}**, then check again.`)],
      components: [checkRow()],
    });
  },
};
