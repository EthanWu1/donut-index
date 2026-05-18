/*
 * One-time importer: pulls the MineCatalog registry (one proper inventory
 * icon per Minecraft item/block, ~1,227 entries), wipes any previously
 * uploaded emojis, and uploads the icons as Discord application emojis.
 * Writes data/item-emojis.json (item id -> "<:name:id>").
 *
 * Run on the host with the bot token:  node scripts/import-item-emojis.js
 * Source: https://github.com/JHVIW/MineCatalog  (MIT, daily-updated)
 */
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { REST, Routes } = require('discord.js');

const TOKEN = process.env.BOT_TOKEN;
const APP_ID = process.env.CLIENT_ID;
const MAX_EMOJIS = 2000;
const SRC = 'https://raw.githubusercontent.com/JHVIW/MineCatalog/main/minecraft-items.json';
const MAP_PATH = path.join(__dirname, '..', 'data', 'item-emojis.json');

// GET with redirect handling, resolves to a Buffer.
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'donut-index' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(res.headers.location));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function main() {
  if (!TOKEN || !APP_ID) {
    console.error('BOT_TOKEN and CLIENT_ID must be set in .env');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(MAP_PATH), { recursive: true });

  console.log('Downloading MineCatalog item registry...');
  const data = JSON.parse((await get(SRC)).toString());
  const items = Array.isArray(data.items) ? data.items : [];
  console.log(`Registry has ${items.length} items.`);

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  // Clear previously uploaded emojis (the old run uploaded texture fragments).
  const existingRes = await rest.get(Routes.applicationEmojis(APP_ID));
  const existing = existingRes.items || existingRes || [];
  if (existing.length) {
    console.log(`Deleting ${existing.length} old emojis...`);
    let del = 0;
    for (const em of existing) {
      try {
        await rest.delete(Routes.applicationEmoji(APP_ID, em.id));
        del += 1;
        if (del % 100 === 0) console.log(`  deleted ${del}/${existing.length}...`);
      } catch (e) {
        console.warn(`  delete ${em.name}: ${e.message}`);
      }
    }
  }

  const map = {};
  const usedNames = new Set();
  let uploaded = 0;
  for (const it of items) {
    if (uploaded >= MAX_EMOJIS) {
      console.log(`Hit the ${MAX_EMOJIS} emoji cap, stopping.`);
      break;
    }
    const id = String(it.itemId || '').toLowerCase();
    const img = it.imgSrc;
    if (!id || typeof img !== 'string' || !img.startsWith('data:image')) continue;

    let name = id.slice(0, 32).replace(/[^a-z0-9_]/g, '_');
    if (name.length < 2) name = `mc_${name}`;
    while (usedNames.has(name)) name = `${name.slice(0, 29)}${Math.floor(Math.random() * 900 + 100)}`;
    usedNames.add(name);

    try {
      const created = await rest.post(Routes.applicationEmojis(APP_ID), { body: { name, image: img } });
      map[id] = `<:${name}:${created.id}>`;
      uploaded += 1;
      if (uploaded % 100 === 0) console.log(`  uploaded ${uploaded}...`);
    } catch (e) {
      console.warn(`  skip ${id}: ${e.message}`);
    }
  }

  fs.writeFileSync(MAP_PATH, JSON.stringify(map));
  console.log(`Done. Uploaded ${uploaded} emojis; map has ${Object.keys(map).length} entries.`);
  console.log('Now restart the bot: pm2 restart donut-index');
}

main().catch((e) => { console.error(e); process.exit(1); });
