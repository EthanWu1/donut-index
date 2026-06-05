const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} = require('discord.js');
const api = require('../lib/api');
const { getAuctionIndex, normalizeListing, extractList } = require('../jobs/auction');
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
  } = getAuctionIndex();
  if (query) {
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
      // Fall through to cached/stale index.
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
    source = stale ? 'stale fallback' : 'cached fallback';
    const q = query.toLowerCase();
    items = items.filter((it) => (it.searchText || it.name || '').toLowerCase().includes(q));
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
    const { listings } = getAuctionIndex();
    const q = interaction.options.getFocused().toLowerCase();
    const seen = new Set();
    const out = [];
    for (const it of listings) {
      if (out.length >= 25) break;
      if ((it.searchText || it.name || '').toLowerCase().includes(q) && !seen.has(it.name)) {
        seen.add(it.name);
        out.push({ name: it.name, value: it.name });
      }
    }
    await interaction.respond(out);
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
};
