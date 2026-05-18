const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} = require('discord.js');
const { getAuctionIndex } = require('../jobs/auction');
const { auctionEmbed, errorEmbed } = require('../lib/embeds');
const { relativeTime } = require('../lib/format');

const PER_PAGE = 12;
const SORTS = ['newest', 'price_asc', 'price_desc'];

// Synchronous: reads the in-memory auction index, no API calls.
function view(page, query, sort) {
  const { listings, updatedAt } = getAuctionIndex();
  if (updatedAt === 0) {
    return {
      embeds: [errorEmbed('The auction index is still building. Try again in a few seconds.')],
      components: [],
    };
  }

  let items = listings;
  if (query) {
    const q = query.toLowerCase();
    items = items.filter((it) => it.name.toLowerCase().includes(q));
  }
  if (sort === 'price_asc') items = items.slice().sort((a, b) => a.price - b.price);
  else if (sort === 'price_desc') items = items.slice().sort((a, b) => b.price - a.price);
  // 'newest' keeps index order (auction page 1 is the newest listings)

  const totalPages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageItems = items.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  const heading = query ? `Auction House: "${query}"` : 'Auction House';
  const footer = `${items.length} listing${items.length === 1 ? '' : 's'}`
    + ` · page ${safePage}/${totalPages} · updated ${relativeTime(updatedAt)}`;
  const embed = auctionEmbed(heading, pageItems, footer);

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
    new ButtonBuilder().setCustomId(`ah:page:${safePage - 1}:${sort}:${enc}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(safePage <= 1),
    new ButtonBuilder().setCustomId(`ah:page:${safePage + 1}:${sort}:${enc}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(safePage >= totalPages),
  );
  return { embeds: [embed], components: [sortRow, navRow] };
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
      if (it.name.toLowerCase().includes(q) && !seen.has(it.name)) {
        seen.add(it.name);
        out.push({ name: it.name, value: it.name });
      }
    }
    await interaction.respond(out);
  },

  async execute(interaction) {
    const query = (interaction.options.getString('item') || '').trim();
    return interaction.reply(view(1, query, 'price_desc'));
  },

  // Button: ah:page:<page>:<sort>:<encodedQuery>
  async button(interaction) {
    const [, , pageStr, sort, enc] = interaction.customId.split(':');
    const s = SORTS.includes(sort) ? sort : 'price_desc';
    return interaction.update(view(Math.max(1, Number(pageStr) || 1), decodeURIComponent(enc || ''), s));
  },

  // Select menu: ah:sort:<page>:<encodedQuery> — chosen value is the sort order.
  async selectMenu(interaction) {
    const [, , pageStr, enc] = interaction.customId.split(':');
    return interaction.update(view(Math.max(1, Number(pageStr) || 1), decodeURIComponent(enc || ''), interaction.values[0]));
  },
};
