const crypto = require('node:crypto');
const {
  SlashCommandBuilder, AttachmentBuilder, EmbedBuilder,
  ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags,
} = require('discord.js');
const { renderLitematic } = require('../lib/renderClient');
const { getAuctionIndex } = require('../jobs/auction');
const { errorEmbed } = require('../lib/embeds');
const { formatNumber } = require('../lib/format');
const { itemEmoji } = require('../lib/itemEmojis');

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;
const USER_COOLDOWN_MS = 30_000;
const QUEUE_MAX = 3;
const IMAGE_SIZE = 1024;
const SESSION_TTL_MS = 15 * 60 * 1000;
const SESSION_MAX = 30;
const sessions = new Map();
const cooldowns = new Map();
let inFlight = 0;

function pruneSessions() {
  const now = Date.now();
  for (const [token, sess] of sessions) {
    if (now - sess.createdAt > SESSION_TTL_MS) sessions.delete(token);
  }
  while (sessions.size > SESSION_MAX) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
}

function normalizeRotation(deg) {
  return ((Math.round(Number(deg) || 0) % 360) + 360) % 360;
}

function formatCount(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function materialName(m) {
  return String(m && (m.name || m.key) || 'Unknown item')
    .replace(/^minecraft:/i, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function schematicVolume(size) {
  if (!size) return 0;
  return Math.max(0, Number(size.x || 0))
       * Math.max(0, Number(size.y || 0))
       * Math.max(0, Number(size.z || 0));
}

function safeName(name) {
  const base = String(name || 'render')
    .replace(/\.litematic$/i, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return `${base || 'render'}-render.png`;
}

function estimateMaterialCost(materials = [], listings = []) {
  const lines = [];
  let total = 0;
  for (const mat of materials) {
    const key = String(mat.key || '').replace(/^minecraft:/i, '').toLowerCase();
    const matches = listings.filter((it) => String(it.key || '').toLowerCase() === key && Number(it.price) > 0);
    if (matches.length === 0) {
      lines.push({ ...mat, name: materialName(mat), missing: true, stackPrice: null, cost: null });
      continue;
    }
    const stackPrice = Math.min(...matches.map((it) => {
      const amount = Math.max(1, Number(it.amount) || 1);
      return Math.ceil((Number(it.price) / amount) * 64);
    }));
    const stacks = Math.max(0, Number(mat.stacks) || Math.ceil((Number(mat.count) || 0) / 64));
    const cost = stackPrice * stacks;
    total += cost;
    lines.push({ ...mat, name: materialName(mat), stacks, stackPrice, cost });
  }
  return { total, lines };
}

function materialListPayload(materials = []) {
  const lines = (materials || []).map((m) => {
    const emoji = itemEmoji(m.key) || itemEmoji(materialName(m)) || '';
    const stacks = Math.max(0, Number(m.stacks) || Math.ceil((Number(m.count) || 0) / 64));
    const suffix = stacks > 1 ? ` - ${formatCount(stacks)} stacks` : '';
    return `${emoji ? `${emoji} ` : ''}**${materialName(m)}:** \`${formatCount(m.count)}\`${suffix}`;
  });
  if (lines.length === 0) lines.push('_No material metadata was returned._');
  const embeds = [];
  let chunk = '### Material List\n\n';
  for (const line of lines) {
    if ((chunk + line + '\n').length > 3900) {
      embeds.push(new EmbedBuilder().setColor(0x2b2d31).setDescription(chunk.trimEnd()));
      chunk = '';
    }
    chunk += `${line}\n`;
  }
  if (chunk.trim()) embeds.push(new EmbedBuilder().setColor(0x2b2d31).setDescription(chunk.trimEnd()));
  return { embeds: embeds.slice(0, 10), flags: MessageFlags.Ephemeral };
}

function costPayload(materials = []) {
  const { listings, stale, updatedAt } = getAuctionIndex();
  const estimate = estimateMaterialCost(materials, listings);
  const shown = estimate.lines.slice(0, 15);
  const lines = shown.map((m) => {
    if (m.missing) return `**${m.name}:** no AH stack price found`;
    return `**${m.name}:** ${formatCount(m.stacks)} stack${m.stacks === 1 ? '' : 's'} x $${formatNumber(m.stackPrice)} = \`$${formatNumber(m.cost)}\``;
  });
  if (estimate.lines.length > shown.length) lines.push(`_...and ${estimate.lines.length - shown.length} more._`);
  const footer = updatedAt
    ? `AH ${stale ? 'stale fallback' : 'cache'} from ${new Date(updatedAt).toLocaleString('en-US')}`
    : 'AH prices are not available yet';
  const embed = new EmbedBuilder()
    .setColor(0x4aa3df)
    .setDescription(`### Estimated Material Cost\n\n${lines.join('\n') || '_No material metadata was returned._'}\n\n**Total:** \`$${formatNumber(estimate.total)}\``)
    .setFooter({ text: footer });
  return { embeds: [embed], flags: MessageFlags.Ephemeral };
}

function buildMessage({
  png, meta = {}, fileName = 'render.litematic', rotation = 0, token,
}) {
  const size = meta.size || { x: 0, y: 0, z: 0 };
  const title = meta.name || fileName.replace(/\.litematic$/i, '') || 'Litematic Render';
  const attachment = new AttachmentBuilder(png, { name: safeName(title) });
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(title)
    .addFields(
      { name: 'Blocks', value: `\`${formatCount(meta.blockCount)} / ${formatCount(schematicVolume(size))}\``, inline: true },
      { name: 'Size', value: `\`${formatCount(size.x)} x ${formatCount(size.y)} x ${formatCount(size.z)}\``, inline: true },
    )
    .setImage(`attachment://${attachment.name}`)
    .setFooter({ text: `Rotation ${normalizeRotation(rotation)} deg` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`render:rot:${token}:l`).setLabel('←').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`render:rot:${token}:r`).setLabel('→').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`render:mat:${token}`).setLabel('Material List').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`render:cost:${token}`).setLabel('Estimated Cost').setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], files: [attachment], attachments: [], components: [row] };
}

async function fetchAttachmentBuffer(file) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DOWNLOAD_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(file.url, { signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_FILE_BYTES) throw new Error('file too large after download');
  return buf;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('render')
    .setDescription('Render a .litematic schematic to an image')
    .addAttachmentOption((o) =>
      o.setName('litematic').setDescription('The .litematic file to render').setRequired(true)),

  async execute(interaction) {
    const file = interaction.options.getAttachment('litematic');
    if (!file || !/\.litematic$/i.test(file.name || '')) {
      return interaction.reply({
        embeds: [errorEmbed('Attach a `.litematic` file to render.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (typeof file.size === 'number' && file.size > MAX_FILE_BYTES) {
      return interaction.reply({
        embeds: [errorEmbed(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_FILE_BYTES / 1024 / 1024} MB.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    const now = Date.now();
    const last = cooldowns.get(interaction.user.id) || 0;
    if (now - last < USER_COOLDOWN_MS) {
      const remain = Math.ceil((USER_COOLDOWN_MS - (now - last)) / 1000);
      return interaction.reply({
        embeds: [errorEmbed(`Please wait ${remain}s before another render.`)],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (inFlight >= QUEUE_MAX) {
      return interaction.reply({
        embeds: [errorEmbed(`Renderer busy (${QUEUE_MAX} in flight). Try again shortly.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    cooldowns.set(interaction.user.id, now);
    await interaction.deferReply();
    inFlight += 1;
    try {
      const buf = await fetchAttachmentBuffer(file);
      const { png, meta } = await renderLitematic(buf, {
        width: IMAGE_SIZE, height: IMAGE_SIZE, transparentBackground: true,
      });
      pruneSessions();
      const token = crypto.randomBytes(8).toString('hex');
      sessions.set(token, {
        buffer: buf,
        name: file.name,
        rotation: 0,
        materials: meta.materials || [],
        ownerId: interaction.user.id,
        createdAt: Date.now(),
      });
      return interaction.editReply(buildMessage({
        png, meta, fileName: file.name, rotation: 0, token,
      }));
    } catch (err) {
      return interaction.editReply({
        embeds: [errorEmbed(`Render failed: ${String(err.message || err).slice(0, 300)}`)],
      });
    } finally {
      inFlight = Math.max(0, inFlight - 1);
    }
  },

  async button(interaction) {
    const [, sub, token, dir] = interaction.customId.split(':');
    pruneSessions();
    const sess = sessions.get(token);
    if (!sess) {
      return interaction.reply({
        embeds: [errorEmbed('This render has expired - run `/render` again.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (String(interaction.user.id) !== String(sess.ownerId)) {
      return interaction.reply({
        embeds: [errorEmbed('Only the person who ran `/render` can use this.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (sub === 'mat') return interaction.reply(materialListPayload(sess.materials || []));
    if (sub === 'cost') return interaction.reply(costPayload(sess.materials || []));
    if (sub !== 'rot') return undefined;

    await interaction.deferUpdate().catch(() => {});
    sess.rotation = normalizeRotation(sess.rotation + (dir === 'l' ? -90 : 90));
    sess.createdAt = Date.now();
    try {
      const { png, meta } = await renderLitematic(sess.buffer, {
        width: IMAGE_SIZE,
        height: IMAGE_SIZE,
        transparentBackground: true,
        yawDegrees: sess.rotation,
      });
      sess.materials = meta.materials || sess.materials || [];
      return interaction.editReply(buildMessage({
        png, meta, fileName: sess.name, rotation: sess.rotation, token,
      }));
    } catch (err) {
      return interaction.followUp({
        embeds: [errorEmbed(`Render failed: ${String(err.message || err).slice(0, 200)}`)],
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  },

  buildMessage,
  estimateMaterialCost,
  materialListPayload,
};
