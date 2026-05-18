const path = require('node:path');
const fs = require('node:fs');

// Map of item key -> "<:name:id>", produced by scripts/import-item-emojis.js.
// Absent until that script has been run on the host; the bot works fine
// without it (commands just show no item icon).
const MAP_PATH = path.join(__dirname, '..', 'data', 'item-emojis.json');

// Words dropped when building a fuzzy signature, so "block_of_netherite"
// (spreadsheet wording) matches "netherite_block" (Minecraft id).
const STOP = new Set(['of', 'the', 'a', 'an']);

function signature(key) {
  return String(key)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w))
    .sort()
    .join(',');
}

let map = {};
let byWords = {};

function load() {
  try { map = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8')) || {}; }
  catch { map = {}; }
  byWords = {};
  for (const k of Object.keys(map)) {
    const s = signature(k);
    if (s && !(s in byWords)) byWords[s] = map[k];
  }
}
load();

// Emoji string for an item key: exact match, then a word-set fuzzy match,
// or '' if nothing maps.
function itemEmoji(key) {
  if (!key) return '';
  const k = String(key).toLowerCase();
  if (map[k]) return map[k];
  return byWords[signature(k)] || '';
}

function count() {
  return Object.keys(map).length;
}

module.exports = { itemEmoji, reload: load, count };
