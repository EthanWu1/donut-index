const path = require('node:path');
const fs = require('node:fs');

// Map of item key -> "<:name:id>", produced by scripts/import-item-emojis.js.
// Absent until that script has been run on the host; the bot works fine
// without it (commands just show no item icon).
const MAP_PATH = path.join(__dirname, '..', 'data', 'item-emojis.json');

let map = {};
function load() {
  try { map = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8')) || {}; }
  catch { map = {}; }
}
load();

// Returns the emoji string for an item key, or '' if none is mapped.
function itemEmoji(key) {
  if (!key) return '';
  return map[String(key).toLowerCase()] || '';
}

function count() {
  return Object.keys(map).length;
}

module.exports = { itemEmoji, reload: load, count };
