const crypto = require('node:crypto');
const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const api = require('../lib/api');
const db = require('../lib/db');
const config = require('../config');
const { errorEmbed } = require('../lib/embeds');
const { itemEmoji } = require('../lib/itemEmojis');

// "1m" / "500k" / "250,000" / "1.5m" -> a whole number, or NaN.
function parseAmount(input) {
  const m = /^([\d,.]+)\s*([kmb])?$/i.exec(String(input || '').trim());
  if (!m) return NaN;
  const n = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return NaN;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1;
  return Math.round(n * mult);
}

const STATUS = {
  WATCHING: { color: config.colors.leaderboard, text: 'Watching for the payment…' },
  PAID: { color: config.colors.online, text: 'Payment confirmed.' },
  EXPIRED: { color: config.colors.offline, text: 'Expired — the payment was not detected in time.' },
  CANCELLED: { color: config.colors.offline, text: 'Cancelled.' },
};

// Renders a watch (a pay_watches DB row) into a message payload. Used by the
// command and by the polling job when it updates the message in place.
function payView(w) {
  const emoji = itemEmoji('emerald');
  const amount = `$${Number(w.amount).toLocaleString('en-US')}`;
  const s = STATUS[w.status] || STATUS.WATCHING;

  const lines = [
    '### Payment Watch',
    '',
    `${emoji ? `${emoji} ` : ''}**Amount:** ${amount}`,
    `**From:** \`${w.payer_ign}\``,
    `**To:** \`${w.receiver_ign}\``,
    '',
    s.text,
  ];

  const embed = new EmbedBuilder()
    .setColor(s.color)
    .setDescription(lines.join('\n'))
    .setTimestamp(w.created_at);

  const components = [];
  if (w.status === 'WATCHING') {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`pay:cancel:${w.id}`).setLabel('Cancel').setStyle(ButtonStyle.Danger),
    ));
  }
  return { embeds: [embed], components };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pay')
    .setDescription('Watch the DonutSMP API for a payment between two players')
    .addStringOption((o) =>
      o.setName('payer').setDescription("Sender's Minecraft IGN").setRequired(true).setMaxLength(16))
    .addStringOption((o) =>
      o.setName('receiver').setDescription("Receiver's Minecraft IGN").setRequired(true).setMaxLength(16))
    .addStringOption((o) =>
      o.setName('amount').setDescription('Amount to watch for (e.g. 500k, 1m, 250000)').setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply();
    const payerIgn = interaction.options.getString('payer').trim();
    const receiverIgn = interaction.options.getString('receiver').trim();
    const amount = parseAmount(interaction.options.getString('amount'));

    if (!amount || amount <= 0) {
      return interaction.editReply({
        embeds: [errorEmbed('Invalid amount. Use `500k`, `1m`, or a plain number like `250000`.')],
      });
    }

    // Live balance reads validate both IGNs and give the baselines the watch
    // measures against.
    let payerStart;
    try {
      payerStart = await api.getBalance(payerIgn);
    } catch (err) {
      if (err instanceof api.NotFoundError) {
        return interaction.editReply({ embeds: [errorEmbed(`No DonutSMP player named \`${payerIgn}\` was found.`)] });
      }
      return interaction.editReply({ embeds: [errorEmbed('Could not reach the DonutSMP API. Try again shortly.')] });
    }
    let receiverStart;
    try {
      receiverStart = await api.getBalance(receiverIgn);
    } catch (err) {
      if (err instanceof api.NotFoundError) {
        return interaction.editReply({ embeds: [errorEmbed(`No DonutSMP player named \`${receiverIgn}\` was found.`)] });
      }
      return interaction.editReply({ embeds: [errorEmbed('Could not reach the DonutSMP API. Try again shortly.')] });
    }

    const now = Date.now();
    const id = crypto.randomBytes(4).toString('hex');
    db.addWatch({
      id,
      status: 'WATCHING',
      channelId: null,
      messageId: null,
      creatorId: interaction.user.id,
      payerId: null,
      payerIgn,
      receiverIgn,
      amount,
      reason: null,
      payerStart,
      receiverStart,
      createdAt: now,
      expiresAt: now + config.payWatchTimeoutMs,
    });

    // The polling job (jobs/pay.js) picks the watch up on its next sweep.
    const msg = await interaction.editReply(payView(db.getWatch(id)));
    db.setWatchMessage(id, msg.channelId || interaction.channelId, msg.id);
    return undefined;
  },

  // Button: pay:cancel:<id> — only the watch's creator may cancel it.
  async button(interaction) {
    const [, action, id] = interaction.customId.split(':');
    if (action !== 'cancel') return undefined;

    const w = db.getWatch(id);
    if (!w) {
      return interaction.reply({ embeds: [errorEmbed('That watch no longer exists.')], flags: MessageFlags.Ephemeral });
    }
    if (w.status !== 'WATCHING') {
      return interaction.reply({
        embeds: [errorEmbed(`This watch is already ${w.status.toLowerCase()}.`)],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (w.creator_id !== interaction.user.id) {
      return interaction.reply({
        embeds: [errorEmbed('Only the person who started this watch can cancel it.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    db.setWatchStatus(id, 'CANCELLED');
    return interaction.update(payView(db.getWatch(id)));
  },

  payView,
};
