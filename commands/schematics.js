const fs = require('node:fs');
const path = require('node:path');
const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, EmbedBuilder, AttachmentBuilder, MessageFlags,
} = require('discord.js');
const config = require('../config');
const db = require('../lib/db');
const { getSchematicIndex } = require('../jobs/schematics');
const { errorEmbed } = require('../lib/embeds');
const { renderLitematic } = require('../lib/renderClient');
const { deliverHoloprint } = require('./holoprint');
const { materialListPayload } = require('./render');

// Strips the extension and filesystem-unsafe characters from a staff-typed
// schematic filename, keeping spaces and wording.
function cleanFileName(name) {
  return String(name || '')
    .replace(/\.litematic$/i, '')
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '')
    .trim()
    .slice(0, 80);
}

// The base filename (no extension) the bot serves for a schematic — a staff
// override from the schematic_names table if set, else the original
// .litematic attachment name.
function effectiveBaseName(s) {
  const override = db.getSchematicName(s.threadId);
  if (override) return override;
  return cleanFileName(s.litematicName || `${s.name}.litematic`) || 'schematic';
}

const PER_PAGE = 8;
const TAG_RENDERS_DIR = path.join(__dirname, '..', 'assets', 'tag-renders');

// Normalised forum-tag name -> tag-render gif basename. Tag names on the
// forum do not match the gif filenames, so the mapping is explicit.
const TAG_GIF = {
  berry: 'sweet_berry',
  trap: 'crafting_table',
  bone: 'bone_block',
  stash: 'amethyst_shard',
  loader: 'hopper',
  unloader: 'shulker_box',
  cobblestone: 'cobblestone',
  crafter: 'crafter',
  kelp: 'kelp',
};

// Animated emoji icons for the tag-filter dropdown — the tag-render gifs
// uploaded as Donut Index application emojis. Keyed by normalised tag name
// (`all` carries the command-block icon for the "All" option).
const TAG_EMOJI = {
  all: { id: '1505935988139098324', name: 'command_block_tag', animated: true },
  berry: { id: '1505936004714860695', name: 'sweet_berry_tag', animated: true },
  trap: { id: '1505935994363449514', name: 'crafting_table_tag', animated: true },
  bone: { id: '1505935968677531669', name: 'bone_block_tag', animated: true },
  stash: { id: '1505935964009402388', name: 'amethyst_shard_tag', animated: true },
  loader: { id: '1505935996758523915', name: 'hopper_tag', animated: true },
  unloader: { id: '1505936002705789110', name: 'shulker_box_tag', animated: true },
  cobblestone: { id: '1505935974935560202', name: 'cobblestone_tag', animated: true },
  crafter: { id: '1505935991670833162', name: 'crafter_tag', animated: true },
  kelp: { id: '1505935999270912090', name: 'kelp_tag', animated: true },
};

function tagKey(name) {
  return String(name || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// assets/tag-renders/<gif>.gif for a forum tag, if bundled.
function tagGif(tagName) {
  const key = tagKey(tagName);
  if (!key) return null;
  const base = TAG_GIF[key] || key;
  const file = path.join(TAG_RENDERS_DIR, `${base}.gif`);
  return fs.existsSync(file) ? { path: file, name: `${base}.gif` } : null;
}

// Paginated browse list. No tag-render gif here — kept clean and uncramped.
function buildListView(tag, page) {
  const { schematics, tags } = getSchematicIndex();
  const filtered = tag === 'all'
    ? schematics
    : schematics.filter((s) => s.tags.some((t) => t.id === tag));
  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const p = Math.min(Math.max(1, page), pages);
  const slice = filtered.slice((p - 1) * PER_PAGE, p * PER_PAGE);

  const lines = slice.length
    ? slice.map((s, i) => `**${(p - 1) * PER_PAGE + i + 1}.**  ${s.name}`)
    : ['_No schematics here yet._'];

  const embed = new EmbedBuilder()
    .setColor(config.colors.schematic)
    .setDescription(`### Schematic\n\n${lines.join('\n')}`)
    .setFooter({ text: `Page ${p}/${pages} · ${filtered.length} schematic${filtered.length === 1 ? '' : 's'}` });

  const rows = [];
  const allOption = { label: 'All', value: 'all', default: tag === 'all' };
  if (TAG_EMOJI.all) allOption.emoji = TAG_EMOJI.all;
  const tagOptions = [allOption].concat(tags.slice(0, 24).map((t) => {
    const opt = { label: t.name.slice(0, 100), value: t.id, default: t.id === tag };
    const emoji = TAG_EMOJI[tagKey(t.name)];
    if (emoji) opt.emoji = emoji;
    return opt;
  }));
  rows.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('schematics:tag')
      .setPlaceholder('Filter by tag')
      .addOptions(tagOptions),
  ));
  if (slice.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`schematics:pick:${tag}:${p}`)
        .setPlaceholder('View a schematic')
        .addOptions(slice.map((s) => ({ label: s.name.slice(0, 100), value: s.threadId }))),
    ));
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`schematics:page:${tag}:${p - 1}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(p <= 1),
    new ButtonBuilder().setCustomId(`schematics:page:${tag}:${p + 1}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(p >= pages),
  ));
  // files/attachments cleared so navigating back from a detail view drops
  // that view's gif thumbnail.
  return { embeds: [embed], components: rows, files: [], attachments: [] };
}

// Single-schematic detail: render image + tag-render gif thumbnail + buttons.
function buildDetailView(threadId, tag, page) {
  const { schematics, guildId } = getSchematicIndex();
  const s = schematics.find((x) => x.threadId === threadId);
  if (!s) {
    return {
      embeds: [errorEmbed('That schematic is no longer in the index.')],
      components: [], files: [], attachments: [],
    };
  }

  const embed = new EmbedBuilder()
    .setColor(config.colors.schematic)
    .setTitle(s.name)
    .setDescription(s.body ? s.body.slice(0, 1500) : '_No description._');
  if (s.renderUrl) embed.setImage(s.renderUrl);
  embed.addFields({ name: 'File', value: `\`${effectiveBaseName(s)}.litematic\`` });

  const files = [];
  for (const t of s.tags) {
    const gif = tagGif(t.name);
    if (gif) {
      files.push(new AttachmentBuilder(gif.path, { name: gif.name }));
      embed.setThumbnail(`attachment://${gif.name}`);
      break;
    }
  }

  const row = buildDetailActionRow(s, tag, page, guildId);
  return { embeds: [embed], components: [row], files, attachments: [] };
}

function buildDetailActionRow(s, tag, page, guildId) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`schematics:dl:${s.threadId}`).setLabel('Download').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`schematics:holo:${s.threadId}`).setLabel('HoloPrint').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`schematics:mat:${s.threadId}`).setLabel('Material List').setStyle(ButtonStyle.Secondary),
  );
  if (guildId) {
    row.addComponents(
      new ButtonBuilder().setLabel('View Post').setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${guildId}/${s.threadId}`),
    );
  }
  row.addComponents(
    new ButtonBuilder().setCustomId(`schematics:page:${tag}:${page}`).setLabel('Back').setStyle(ButtonStyle.Secondary),
  );
  return row;
}

function attachmentDownloadCandidates(att) {
  return [
    att?.url,
    att?.proxyURL,
    att?.proxyUrl,
    att?.proxy_url,
  ].filter(Boolean).filter((url, idx, arr) => arr.indexOf(url) === idx);
}

async function downloadAttachmentBuffer(att) {
  const urls = attachmentDownloadCandidates(att);
  let lastError = null;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Download failed: ${lastError?.message || 'no URL available'}`);
}

// Re-fetches the .litematic from the live forum post (the indexed CDN url may
// have expired), so Download always serves a fresh file.
async function fetchSchematicFile(client, threadId) {
  const thread = await client.channels.fetch(threadId).catch(() => null);
  if (!thread) throw new Error('Schematic post not found.');
  const starter = await thread.fetchStarterMessage().catch(() => null);
  const att = starter
    && [...starter.attachments.values()].find((a) => /\.litematic$/i.test(a.name || ''));
  if (!att) throw new Error('No `.litematic` file found on that post.');
  return { buffer: await downloadAttachmentBuffer(att), name: att.name };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schematics')
    .setDescription('Browse the schematic library')
    .addStringOption((o) =>
      o.setName('search').setDescription('Jump straight to a schematic by name').setAutocomplete(true)),

  async autocomplete(interaction) {
    const q = interaction.options.getFocused().toLowerCase();
    const { schematics } = getSchematicIndex();
    const out = schematics
      .filter((s) => s.name.toLowerCase().includes(q))
      .slice(0, 25);
    await interaction.respond(out.map((s) => ({ name: s.name.slice(0, 100), value: s.name.slice(0, 100) })));
  },

  async execute(interaction) {
    const search = interaction.options.getString('search');
    const { schematics } = getSchematicIndex();
    if (!schematics.length) {
      return interaction.reply({
        embeds: [errorEmbed('No schematics indexed yet. They appear here once posted and tagged in the schematic forum.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (search) {
      const q = search.toLowerCase();
      const found = schematics.find((s) => s.name.toLowerCase() === q)
        || schematics.find((s) => s.name.toLowerCase().includes(q));
      if (found) return interaction.reply(buildDetailView(found.threadId, 'all', 1));
    }
    return interaction.reply(buildListView('all', 1));
  },

  // Buttons: schematics:page:<tag>:<page> | schematics:dl:<threadId> | schematics:holo:<threadId> | schematics:mat:<threadId>
  async button(interaction) {
    const parts = interaction.customId.split(':');
    if (parts[1] === 'page') {
      await interaction.deferUpdate();
      return interaction.editReply(buildListView(parts[2], Number(parts[3]) || 1));
    }
    if (parts[1] === 'dl') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const { buffer, name } = await fetchSchematicFile(interaction.client, parts[2]);
        const override = db.getSchematicName(parts[2]);
        const fileName = override ? `${override}.litematic` : name;
        return interaction.editReply({ files: [new AttachmentBuilder(buffer, { name: fileName })] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }
    if (parts[1] === 'holo') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const { buffer, name } = await fetchSchematicFile(interaction.client, parts[2]);
        const override = db.getSchematicName(parts[2]);
        return await deliverHoloprint(interaction, buffer, override ? `${override}.litematic` : name);
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }
    if (parts[1] === 'mat') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const { buffer } = await fetchSchematicFile(interaction.client, parts[2]);
        const { meta } = await renderLitematic(buffer, {
          width: 256,
          height: 256,
          transparentBackground: true,
        });
        const payload = materialListPayload(meta?.materials || []);
        delete payload.flags;
        return interaction.editReply(payload);
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }
    return undefined;
  },

  // Select menus: schematics:tag | schematics:pick:<tag>:<page>
  async selectMenu(interaction) {
    const parts = interaction.customId.split(':');
    if (parts[1] === 'tag') {
      await interaction.deferUpdate();
      return interaction.editReply(buildListView(interaction.values[0], 1));
    }
    if (parts[1] === 'pick') {
      await interaction.deferUpdate();
      return interaction.editReply(buildDetailView(interaction.values[0], parts[2], Number(parts[3]) || 1));
    }
    return undefined;
  },

  _test: {
    attachmentDownloadCandidates,
    buildDetailActionRow,
    cleanFileName,
    fetchSchematicFile,
  },
};
