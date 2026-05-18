const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} = require('discord.js');
const api = require('../lib/api');
const config = require('../config');
const { auctionEmbed, errorEmbed } = require('../lib/embeds');

const PER_PAGE = 12;
const SORTS = ['default', 'price_asc', 'price_desc'];

// The DonutSMP auction item field can be a string or a nested object;
// pull a usable name out of whatever shape it is.
function readName(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object') {
    return v.name || v.displayName || v.display_name || v.customName
      || v.id || v.type || v.material || null;
  }
  return null;
}

function prettyName(raw) {
  const s = String(raw)
    .replace(/^minecraft:/i, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return s || 'Unknown item';
}

// DonutSMP auction listing shape (verified):
// { seller: { name }, price, time_left, item: { id, count, display_name } }
function normalizeListing(it) {
  const item = it.item || {};
  const dn = typeof item.display_name === 'string'
    ? item.display_name.replace(/§./g, '').trim() : '';
  const rawName = dn || item.id || readName(it.item) || 'Unknown item';
  const amount = Number(item.count ?? it.count ?? it.amount ?? 1) || 1;
  const price = Number(it.price ?? it.cost ?? 0) || 0;
  const seller = (it.seller && it.seller.name) || readName(it.seller) || 'unknown';
  return { name: prettyName(rawName), amount, price, seller: String(seller) };
}

async function fetchPage(apiPage) {
  const raw = await api.getAuctionList(apiPage);
  const list = Array.isArray(raw) ? raw : raw.auctions || raw.listings || raw.items || raw.result || [];
  return (Array.isArray(list) ? list : []).map(normalizeListing);
}

function applySort(items, sort) {
  if (sort === 'price_asc') return items.slice().sort((a, b) => a.price - b.price);
  if (sort === 'price_desc') return items.slice().sort((a, b) => b.price - a.price);
  return items;
}

// page: result page when searching, API page when browsing.
async function buildView(page, query, sort) {
  let pageItems;
  let heading;
  let footer;
  let hasPrev = page > 1;
  let hasNext;

  if (query) {
    // Search: scan many auction pages and collect every match.
    const q = query.toLowerCase();
    const matches = [];
    for (let p = 1; p <= config.ahSearchPages; p++) {
      const items = await fetchPage(p);
      if (items.length === 0) break;
      for (const it of items) if (it.name.toLowerCase().includes(q)) matches.push(it);
    }
    const sorted = applySort(matches, sort);
    const totalPages = Math.max(1, Math.ceil(sorted.length / PER_PAGE));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * PER_PAGE;
    pageItems = sorted.slice(start, start + PER_PAGE);
    hasPrev = safePage > 1;
    hasNext = safePage < totalPages;
    page = safePage;
    heading = `Auction House: "${query}"`;
    footer = `${sorted.length} result${sorted.length === 1 ? '' : 's'} · page ${safePage}/${totalPages}`;
  } else {
    // Browse: just the requested API page.
    const items = applySort(await fetchPage(page), sort);
    pageItems = items.slice(0, PER_PAGE);
    hasNext = items.length > 0;
    heading = 'Auction House';
    footer = `Page ${page}`;
  }

  const embed = auctionEmbed(heading, pageItems, footer);
  const enc = encodeURIComponent(query || '');
  const sortRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`ah:sort:${page}:${enc}`)
      .setPlaceholder('Sort order')
      .addOptions(
        { label: 'Newest first', value: 'default', default: sort === 'default' },
        { label: 'Price: low to high', value: 'price_asc', default: sort === 'price_asc' },
        { label: 'Price: high to low', value: 'price_desc', default: sort === 'price_desc' },
      ),
  );
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ah:page:${page - 1}:${sort}:${enc}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(!hasPrev),
    new ButtonBuilder().setCustomId(`ah:page:${page + 1}:${sort}:${enc}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(!hasNext),
  );
  return { embeds: [embed], components: [sortRow, navRow] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ah')
    .setDescription('Browse or search the DonutSMP auction house')
    .addStringOption((o) => o.setName('item').setDescription('Search for items containing this text')),

  async execute(interaction) {
    await interaction.deferReply();
    const query = (interaction.options.getString('item') || '').trim();
    try {
      return interaction.editReply(await buildView(1, query, 'default'));
    } catch (err) {
      if (err instanceof api.RateLimitedError) {
        return interaction.editReply({ embeds: [errorEmbed('DonutSMP API is rate-limited. Try again shortly.')] });
      }
      throw err;
    }
  },

  // Button: ah:page:<page>:<sort>:<encodedQuery>
  async button(interaction) {
    const [, , pageStr, sort, enc] = interaction.customId.split(':');
    await interaction.deferUpdate();
    const s = SORTS.includes(sort) ? sort : 'default';
    return interaction.editReply(await buildView(Math.max(1, Number(pageStr) || 1), decodeURIComponent(enc || ''), s));
  },

  // Select menu: ah:sort:<page>:<encodedQuery> — chosen value is the sort order.
  async selectMenu(interaction) {
    const [, , pageStr, enc] = interaction.customId.split(':');
    await interaction.deferUpdate();
    return interaction.editReply(await buildView(Math.max(1, Number(pageStr) || 1), decodeURIComponent(enc || ''), interaction.values[0]));
  },
};
