const crypto = require('node:crypto');
const {
  SlashCommandBuilder, AttachmentBuilder, EmbedBuilder,
  ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags,
} = require('discord.js');
const { renderLitematic } = require('../lib/renderClient');
const { errorEmbed } = require('../lib/embeds');

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;
const USER_COOLDOWN_MS = 30_000;
const QUEUE_MAX = 3;
const IMAGE_SIZE = 1024;

// Rotation sessions: the source .litematic is held in memory keyed by a short
// token in the button customId, so the arrows re-render at a new camera yaw
// without re-downloading. Owner-locked, evicted on a TTL.
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

// Embed + image + rotation arrows for a render result.
function buildMessage({ png, meta = {}, fileName = 'render.litematic', rotation = 0, token }) {
  const size = meta.size || { x: 0, y: 0, z: 0 };
  const title = meta.name || fileName.replace(/\.litematic$/i, '') || 'Litematic Render';
  const attachment = new AttachmentBuilder(png, { name: safeName(title) });
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(title)
    .addFields(
      { name: 'Blocks', value: `\`${formatCount(meta.blockCount)} / ${formatCount(schematicVolume(size))}\``, inline: true },
      { name: 'Size', value: `\`${formatCount(size.x)} × ${formatCount(size.y)} × ${formatCount(size.z)}\``, inline: true },
    )
    .setImage(`attachment://${attachment.name}`)
    .setFooter({ text: `Rotation ${normalizeRotation(rotation)}°` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`render:rot:${token}:l`).setLabel('Rotate ⟲').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`render:rot:${token}:r`).setLabel('Rotate ⟳').setStyle(ButtonStyle.Secondary),
  );
  // attachments: [] drops the prior render so a re-rotate doesn't leave a
  // stale image with the same name behind the embed.
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
        buffer: buf, name: file.name, rotation: 0,
        ownerId: interaction.user.id, createdAt: Date.now(),
      });
      return interaction.editReply(buildMessage({ png, meta, fileName: file.name, rotation: 0, token }));
    } catch (err) {
      return interaction.editReply({
        embeds: [errorEmbed(`Render failed: ${String(err.message || err).slice(0, 300)}`)],
      });
    } finally {
      inFlight = Math.max(0, inFlight - 1);
    }
  },

  // Button: render:rot:<token>:<l|r> — re-render the held .litematic at a new yaw.
  async button(interaction) {
    const [, sub, token, dir] = interaction.customId.split(':');
    if (sub !== 'rot') return undefined;

    pruneSessions();
    const sess = sessions.get(token);
    if (!sess) {
      return interaction.reply({
        embeds: [errorEmbed('This render has expired — run `/render` again.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (String(interaction.user.id) !== String(sess.ownerId)) {
      return interaction.reply({
        embeds: [errorEmbed('Only the person who ran `/render` can rotate this.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferUpdate().catch(() => {});
    sess.rotation = normalizeRotation(sess.rotation + (dir === 'l' ? -90 : 90));
    sess.createdAt = Date.now();
    try {
      const { png, meta } = await renderLitematic(sess.buffer, {
        width: IMAGE_SIZE, height: IMAGE_SIZE, transparentBackground: true, yawDegrees: sess.rotation,
      });
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
};
