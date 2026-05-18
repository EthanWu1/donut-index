const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const api = require('../lib/api');
const { auctionEmbed, errorEmbed } = require('../lib/embeds');

function normalizeListing(it) {
  return {
    name: it.item || it.name || it.item_name || 'Unknown item',
    amount: Number(it.amount ?? it.count ?? 1) || 1,
    price: Number(it.price ?? it.cost ?? 0) || 0,
    seller: it.seller || it.owner || it.player || 'unknown',
  };
}

const SORTS = {
  default: null,
  price_asc: (a, b) => a.price - b.price,
  price_desc: (a, b) => b.price - a.price,
};

async function buildPage(page, query, sort) {
  const raw = await api.getAuctionList(page);
  const list = Array.isArray(raw) ? raw : raw.auctions || raw.listings || raw.items || [];
  let items = list.map(normalizeListing);
  if (query) items = items.filter((it) => it.name.toLowerCase().includes(query.toLowerCase()));
  if (SORTS[sort]) items = items.slice().sort(SORTS[sort]);

  const embed = auctionEmbed(page, items.slice(0, 20), query);
  const enc = (s) => encodeURIComponent(s || '');
  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ah:${page - 1}:${enc(query)}:${sort}`).setLabel('Prev').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(`ah:${page + 1}:${enc(query)}:${sort}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(list.length === 0),
  );
  return { embeds: [embed], components: [nav] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ah')
    .setDescription('Browse the DonutSMP auction house')
    .addStringOption((o) => o.setName('search').setDescription('Filter by item name'))
    .addIntegerOption((o) => o.setName('page').setDescription('Page number').setMinValue(1))
    .addStringOption((o) =>
      o.setName('sort').setDescription('Sort order')
        .addChoices(
          { name: 'Price: low to high', value: 'price_asc' },
          { name: 'Price: high to low', value: 'price_desc' },
        )),

  async execute(interaction) {
    await interaction.deferReply();
    const query = interaction.options.getString('search') || '';
    const page = interaction.options.getInteger('page') || 1;
    const sort = interaction.options.getString('sort') || 'default';
    try {
      return interaction.editReply(await buildPage(page, query, sort));
    } catch (err) {
      if (err instanceof api.RateLimitedError) {
        return interaction.editReply({ embeds: [errorEmbed('DonutSMP API is rate-limited — try again shortly.')] });
      }
      throw err;
    }
  },

  async button(interaction) {
    const [, pageStr, queryEnc, sort] = interaction.customId.split(':');
    const page = Math.max(1, Number(pageStr) || 1);
    await interaction.deferUpdate();
    return interaction.editReply(await buildPage(page, decodeURIComponent(queryEnc || ''), sort || 'default'));
  },
};
