const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} = require('discord.js');
const api = require('../lib/api');
const { getAuctionIndex, normalizeListing, extractList } = require('../jobs/auction');
const config = require('../config');
const db = require('../lib/db');
const { auctionEmbed, errorEmbed } = require('../lib/embeds');
const { relativeTime } = require('../lib/format');

const PER_PAGE = 12;
const SORTS = ['newest', 'price_asc', 'price_desc'];
const API_UNAVAILABLE = 'The DonutSMP API service is not available right now. Try again in a moment.';

async function liveSearch(page, query) {
  if (!query) return null;
  const raw = await api.getAuctionList(page, { search: query, sort: 'lowest_price' });
  return extractList(raw)
    .filter((it) => it && typeof it === 'object')
    .map(normalizeListing);
}

function listingId(it) {
  return [
    it && it.key,
    it && it.name,
    it && it.seller,
    it && it.price,
    it && it.amount,
    it && it.enchantText,
  ].join('|');
}

function mergeListings(...groups) {
  const seen = new Set();
  const out = [];
  for (const group of groups) {
    for (const it of group || []) {
      if (!it || typeof it !== 'object') continue;
      const id = listingId(it);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(it);
    }
  }
  return out;
}

function cachedAuctionState() {
  const index = getAuctionIndex();
  const fallback = db.getAuctionCache(config.ahFallbackMs);
  const listings = mergeListings(index.listings, fallback && fallback.listings);
  const fallbackOnly = (!index.updatedAt || !(index.listings || []).length)
    && fallback && fallback.listings.length > 0;
  return {
    ...index,
    listings,
    updatedAt: index.updatedAt || (fallback && fallback.updatedAt) || 0,
    stale: Boolean(index.stale || fallbackOnly),
  };
}

function matchesListing(it, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return `${it.searchText || ''} ${it.name || ''} ${it.key || ''} ${it.enchantText || ''}`
    .toLowerCase()
    .includes(q);
}

function ahSuggestions(query, limit = 25) {
  const q = String(query || '').trim().toLowerCase();
  const rows = [];
  const seen = new Set();
  for (const it of cachedAuctionState().listings) {
    const name = String(it.name || '').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    if (!matchesListing(it, q)) continue;
    seen.add(name.toLowerCase());
    const hay = `${it.searchText || ''} ${it.name || ''} ${it.key || ''}`.toLowerCase();
    const starts = hay.startsWith(q) || name.toLowerCase().startsWith(q) || String(it.key || '').startsWith(q);
    rows.push({ name, value: name, score: starts ? 0 : 1 });
  }
  rows.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return rows.slice(0, limit).map(({ name, value }) => ({ name, value }));
}

function controls(safePage, totalPages, sort, query) {
  const enc = encodeURIComponent(query || '');
  const sortRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`ah:sort:${safePage}:${enc}`)
      .setPlaceholder('Sort order')
      .addOptions(
        { label: 'Newest', value: 'newest', default: sort === 'newest' },
        { label: 'Low to High', value: 'price_asc', default: sort === 'price_asc' },
        { label: 'High to Low', value: 'price_desc', default: sort === 'price_desc' },
      ),
  );
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ah:page:${safePage - 1}:${sort}:${enc}`).setLabel('<').setStyle(ButtonStyle.Secondary).setDisabled(safePage <= 1),
    new ButtonBuilder().setCustomId(`ah:page:${safePage + 1}:${sort}:${enc}`).setLabel('>').setStyle(ButtonStyle.Secondary).setDisabled(safePage >= totalPages),
  );
  return [sortRow, navRow];
}

async function view(page, query, sort) {
  const {
    listings, updatedAt, listingsError, stale,
  } = cachedAuctionState();
  if (query && updatedAt === 0) {
    try {
      const live = await liveSearch(page, query);
      if (live && live.length > 0) {
        const totalPages = Math.max(1, Math.ceil(live.length / PER_PAGE));
        const safePage = Math.min(Math.max(1, page), totalPages);
        const sorted = sort === 'price_desc'
          ? live.slice().sort((a, b) => b.price - a.price)
          : sort === 'price_asc'
            ? live.slice().sort((a, b) => a.price - b.price)
            : live.slice();
        const pageItems = sorted.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);
        const footer = `${live.length} listing${live.length === 1 ? '' : 's'} - page ${safePage}/${totalPages} - live search`;
        return { embeds: [auctionEmbed(query, pageItems, footer)], components: controls(safePage, totalPages, sort, query) };
      }
    } catch {
      // Fall through to the normal unavailable/building messages.
    }
  }
  if (listingsError && updatedAt === 0) {
    return { embeds: [errorEmbed(API_UNAVAILABLE)], components: [] };
  }
  if (updatedAt === 0) {
    return {
      embeds: [errorEmbed('The auction index is still building. Try again in a few seconds.')],
      components: [],
    };
  }

  let items = listings;
  let source = stale ? 'stale fallback' : 'cached index';
  if (query) {
    source = stale ? 'stale fallback' : 'global index';
    items = items.filter((it) => matchesListing(it, query));
  }

  if (sort === 'price_asc') items = items.slice().sort((a, b) => a.price - b.price);
  else if (sort === 'price_desc') items = items.slice().sort((a, b) => b.price - a.price);

  const totalPages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageItems = items.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  const heading = query || 'Auction House';
  const footer = `${items.length} listing${items.length === 1 ? '' : 's'}`
    + ` - page ${safePage}/${totalPages} - ${source} - updated ${relativeTime(updatedAt)}`;
  const embed = auctionEmbed(heading, pageItems, footer);

  return { embeds: [embed], components: controls(safePage, totalPages, sort, query) };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ah')
    .setDescription('Browse or search the DonutSMP auction house')
    .addStringOption((o) =>
      o.setName('item').setDescription('Search for items containing this text').setAutocomplete(true)),

  async autocomplete(interaction) {
    await interaction.respond(ahSuggestions(interaction.options.getFocused(), 25));
  },

  async execute(interaction) {
    const query = (interaction.options.getString('item') || '').trim();
    return interaction.reply(await view(1, query, 'price_asc'));
  },

  async button(interaction) {
    const [, , pageStr, sort, enc] = interaction.customId.split(':');
    const s = SORTS.includes(sort) ? sort : 'price_asc';
    return interaction.update(await view(Math.max(1, Number(pageStr) || 1), decodeURIComponent(enc || ''), s));
  },

  async selectMenu(interaction) {
    const [, , pageStr, enc] = interaction.customId.split(':');
    return interaction.update(await view(Math.max(1, Number(pageStr) || 1), decodeURIComponent(enc || ''), interaction.values[0]));
  },

  view,
  ahSuggestions,
};
