const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} = require('discord.js');
const api = require('../lib/api');
const { auctionEmbed, errorEmbed } = require('../lib/embeds');

// The DonutSMP auction item field can be a string or a nested object —
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
  return String(raw)
    .replace(/^minecraft:/i, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || 'Unknown item';
}

function normalizeListing(it) {
  const rawName = readName(it.item) || readName(it.name) || readName(it.item_name)
    || readName(it.display_name) || readName(it.product) || 'Unknown item';
  const amount = Number(it.amount ?? it.count ?? it.quantity ?? (it.item && it.item.count) ?? 1) || 1;
  const price = Number(it.price ?? it.cost ?? it.buy_price ?? 0) || 0;
  const seller = readName(it.seller) || readName(it.owner) || readName(it.player)
    || readName(it.seller_name) || 'unknown';
  return { name: prettyName(rawName), amount, price, seller };
}

const SORTS = ['default', 'price_asc', 'price_desc'];

async function buildPage(page, query, sort) {
  const raw = await api.getAuctionList(page);
  const list = Array.isArray(raw) ? raw : raw.auctions || raw.listings || raw.items || raw.result || [];
  let items = (Array.isArray(list) ? list : []).map(normalizeListing);
  if (query) {
    const q = query.toLowerCase();
    items = items.filter((it) => it.name.toLowerCase().includes(q));
  }
  if (sort === 'price_asc') items.sort((a, b) => a.price - b.price);
  else if (sort === 'price_desc') items.sort((a, b) => b.price - a.price);

  const embed = auctionEmbed(page, items.slice(0, 12), query);
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
    new ButtonBuilder().setCustomId(`ah:page:${page - 1}:${sort}:${enc}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(`ah:page:${page + 1}:${sort}:${enc}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled((Array.isArray(list) ? list.length : 0) === 0),
  );
  return { embeds: [embed], components: [sortRow, navRow] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ah')
    .setDescription('Browse the DonutSMP auction house')
    .addStringOption((o) => o.setName('item').setDescription('Filter by item name')),

  async execute(interaction) {
    await interaction.deferReply();
    const query = interaction.options.getString('item') || '';
    try {
      return interaction.editReply(await buildPage(1, query, 'default'));
    } catch (err) {
      if (err instanceof api.RateLimitedError) {
        return interaction.editReply({ embeds: [errorEmbed('DonutSMP API is rate-limited — try again shortly.')] });
      }
      throw err;
    }
  },

  // Button: ah:page:<page>:<sort>:<encodedQuery>
  async button(interaction) {
    const [, , pageStr, sort, enc] = interaction.customId.split(':');
    await interaction.deferUpdate();
    const s = SORTS.includes(sort) ? sort : 'default';
    return interaction.editReply(await buildPage(Math.max(1, Number(pageStr) || 1), decodeURIComponent(enc || ''), s));
  },

  // Select menu: ah:sort:<page>:<encodedQuery> — chosen value is the sort order.
  async selectMenu(interaction) {
    const [, , pageStr, enc] = interaction.customId.split(':');
    await interaction.deferUpdate();
    return interaction.editReply(await buildPage(Math.max(1, Number(pageStr) || 1), decodeURIComponent(enc || ''), interaction.values[0]));
  },
};
