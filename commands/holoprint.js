const {
  SlashCommandBuilder, AttachmentBuilder, EmbedBuilder,
  ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags,
} = require('discord.js');
const { litematicToHoloprint } = require('../lib/renderClient');
const { errorEmbed } = require('../lib/embeds');
const config = require('../config');

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;

function formatCount(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function baseName(name) {
  return String(name || 'schematic')
    .replace(/\.litematic$/i, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'schematic';
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
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_FILE_BYTES) throw new Error('File too large after download.');
  return buf;
}

// Converts the litematic and edits the (already deferred) interaction with the
// result — a .holoprint.mcpack when the headless build succeeds, otherwise the
// .mcstructure for the HoloPrint web app. Shared by /holoprint and /schematics.
async function deliverHoloprint(interaction, buffer, sourceName) {
  const result = await litematicToHoloprint(buffer);
  const base = baseName(sourceName || result.name);
  const dims = result.size
    ? `${formatCount(result.size.x)} × ${formatCount(result.size.y)} × ${formatCount(result.size.z)}`
    : 'unknown';
  const meta = `Size \`${dims}\` · \`${formatCount(result.blockCount)}\` blocks.`;
  // Source content the conversion can't carry over (entities, signs, ...).
  const warningLines = (result.warnings && result.warnings.length)
    ? ['', '**Not included:**', ...result.warnings.map((w) => `- ${w}`)]
    : [];

  if (result.kind === 'pack') {
    // HoloPrint names packs "<name>.holoprint.mcpack"; deliver a plain .mcpack.
    const file = new AttachmentBuilder(result.pack, { name: `${base}.mcpack` });
    const embed = new EmbedBuilder()
      .setColor(config.colors.schematic)
      .setDescription([
        '### Holoprint Ready',
        '',
        `Built a HoloPrint \`.mcpack\` from **${sourceName || base}**.`,
        meta,
        '',
        'Open it on a device running Minecraft **Bedrock** to import it, then'
        + ' place the hologram to build along.',
        ...warningLines,
      ].join('\n'));
    return interaction.editReply({ embeds: [embed], files: [file], components: [] });
  }

  // Headless pack build failed — hand back the .mcstructure instead.
  const file = new AttachmentBuilder(result.mcstructure, { name: `${base}.mcstructure` });
  const lines = [
    '### HoloPrint export',
    '',
    `Converted **${sourceName || base}** to a Bedrock \`.mcstructure\`.`,
    meta,
    '',
    'The automatic pack build was unavailable, so drop this `.mcstructure` into'
    + ' the HoloPrint web app to finish your pack.',
    ...warningLines,
  ];
  if (result.packError) lines.push('', `_Pack builder said: ${result.packError}_`);
  const embed = new EmbedBuilder()
    .setColor(config.colors.schematic)
    .setDescription(lines.join('\n'));
  const components = [];
  if (config.holoprintUrl) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Open HoloPrint').setStyle(ButtonStyle.Link).setURL(config.holoprintUrl),
    ));
  }
  return interaction.editReply({ embeds: [embed], files: [file], components });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('holoprint')
    .setDescription('Turn a .litematic into a HoloPrint pack for Minecraft Bedrock')
    .addAttachmentOption((o) =>
      o.setName('litematic').setDescription('The .litematic file to convert').setRequired(true)),

  async execute(interaction) {
    const file = interaction.options.getAttachment('litematic');
    if (!file || !/\.litematic$/i.test(file.name || '')) {
      return interaction.reply({
        embeds: [errorEmbed('Attach a `.litematic` file to convert.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (typeof file.size === 'number' && file.size > MAX_FILE_BYTES) {
      return interaction.reply({
        embeds: [errorEmbed(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_FILE_BYTES / 1024 / 1024} MB.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();
    try {
      const buffer = await fetchAttachmentBuffer(file);
      return await deliverHoloprint(interaction, buffer, file.name);
    } catch (err) {
      return interaction.editReply({ embeds: [errorEmbed(err.message || 'Conversion failed.')] });
    }
  },

  deliverHoloprint,
};
