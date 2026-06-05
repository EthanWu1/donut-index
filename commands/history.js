const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const path = require('node:path');
const fs = require('node:fs');
const db = require('../lib/db');
const config = require('../config');
const { renderChart } = require('../lib/chart');
const { errorEmbed } = require('../lib/embeds');
const auction = require('../jobs/auction');

const RANGE_MS = 30 * 24 * 60 * 60 * 1000;
const PRICES_PATH = path.join(__dirname, '..', 'data', 'prices.json');

function normalizeItem(input) {
  return String(input || '').trim().toLowerCase().replace(/\s+/g, '_');
}

const SMALL = new Set(['of', 'the', 'and', 'a', 'an', 'in', 'on']);
function titleCase(key) {
  return String(key || '').split('_').map((w, i) =>
    (i > 0 && SMALL.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function loadPrices() {
  try { return JSON.parse(fs.readFileSync(PRICES_PATH, 'utf8')); }
  catch { return {}; }
}

function unitPriceForListing(listing) {
  const price = Number(listing && listing.price) || 0;
  const amount = Math.max(1, Number(listing && listing.amount) || 1);
  if (price > 0) return price / amount;
  const stackPrice = Number(listing && listing.stackPrice);
  return stackPrice > 0 ? stackPrice / 64 : 0;
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

function currentAuctionState() {
  const index = auction.getAuctionIndex();
  const { listings = [], transactions = [] } = index;
  const fallback = db.getAuctionCache(config.ahFallbackMs);
  const seen = new Set();
  const mergedListings = [];
  const add = (it) => {
    if (!it || typeof it !== 'object') return;
    const id = listingId(it);
    if (seen.has(id)) return;
    seen.add(id);
    mergedListings.push(it);
  };
  for (const row of listings) add(row);
  if (fallback && Array.isArray(fallback.listings)) {
    for (const row of fallback.listings) add(row);
  }
  return {
    listings: mergedListings,
    transactions,
    updatedAt: index.updatedAt || (fallback && fallback.updatedAt) || 0,
  };
}

function liveAuctionNames() {
  const { listings = [], transactions = [] } = currentAuctionState();
  const out = [];
  for (const row of listings) if (row && row.name) out.push(row.name);
  for (const row of transactions) if (row && row.name) out.push(row.name);
  return out;
}

function historySuggestions(query, limit = 25) {
  const q = String(query || '').trim().toLowerCase();
  const seen = new Set();
  const out = [];
  const add = (name) => {
    const clean = String(name || '').trim();
    if (!clean || (q && !clean.toLowerCase().includes(q))) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name: clean, value: clean });
  };

  for (const item of db.auctionHistoryItems(q, limit)) add(item.name);
  for (const name of liveAuctionNames()) add(name);
  for (const key of Object.keys(loadPrices())) add(titleCase(key));
  return out.slice(0, limit);
}

function bestCurrentListing(input) {
  const q = String(input || '').trim().toLowerCase();
  const key = normalizeItem(input);
  const { listings = [], updatedAt = 0 } = currentAuctionState();
  const candidates = listings
    .map((listing) => ({ listing, unitPrice: unitPriceForListing(listing) }))
    .filter((row) => row.unitPrice > 0);
  const exact = candidates.filter(({ listing }) =>
    String(listing.key || '').toLowerCase() === key
    || String(listing.name || '').toLowerCase() === q);
  const fuzzy = exact.length ? exact : candidates.filter(({ listing }) =>
    String(listing.key || '').toLowerCase().includes(key)
    || String(listing.name || '').toLowerCase().includes(q));
  if (fuzzy.length === 0) return null;
  fuzzy.sort((a, b) => a.unitPrice - b.unitPrice);
  const best = fuzzy[0];
  const averaged = db.averageCheapestUnitPrice(fuzzy.map((row) => row.unitPrice));
  return {
    ts: updatedAt || Date.now(),
    name: best.listing.name || input,
    unitPrice: averaged.unitPrice,
    lowestStackPrice: averaged.unitPrice,
    samples: averaged.samples,
  };
}

function historyRowsFor(input, now = Date.now()) {
  const rows = db.auctionPriceHistory(normalizeItem(input), now - RANGE_MS);
  if (rows.length > 0) {
    return {
      rows,
      name: rows[rows.length - 1].name || input,
      footer: 'Detailed recent points plus compact daily history',
    };
  }
  const current = bestCurrentListing(input);
  if (!current) return { rows: [], name: input, footer: '' };
  return {
    rows: [current],
    name: current.name,
    footer: 'Using current AH data; history will fill in as snapshots run',
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('Show auction-house price history for an item')
    .addStringOption((o) =>
      o.setName('item').setDescription('Item name').setRequired(true).setAutocomplete(true)),

  async autocomplete(interaction) {
    const q = interaction.options.getFocused();
    await interaction.respond(historySuggestions(q, 25));
  },

  async execute(interaction) {
    await interaction.deferReply();
    const input = interaction.options.getString('item');
    const { rows, name, footer } = historyRowsFor(input);
    if (rows.length < 1) {
      return interaction.editReply({ embeds: [errorEmbed(`Not enough auction history for **${input}** yet.`)] });
    }
    const points = rows.map((r) => ({ ts: r.ts, value: r.unitPrice ?? r.lowestStackPrice }));
    const png = renderChart(points, {
      money: true,
      title: `${name} AH History`,
      subtitle: 'Average one-item AH price',
    });
    const file = new AttachmentBuilder(png, { name: 'history.png' });
    const embed = new EmbedBuilder()
      .setColor(config.colors.history)
      .setDescription(`### ${name} AH History\n\nAverage one-item AH price.`)
      .setImage('attachment://history.png')
      .setFooter({ text: footer })
      .setTimestamp();
    return interaction.editReply({ embeds: [embed], files: [file] });
  },
  historySuggestions,
  historyRowsFor,
};
