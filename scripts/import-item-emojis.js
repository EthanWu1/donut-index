/*
 * One-time importer: uploads the bundled item icons (assets/items/, ~1,505
 * rendered Minecraft 1.21.11 icons) as Discord application emojis. Wipes any
 * previously uploaded emojis first. Writes data/item-emojis.json.
 *
 * Run on the host with the bot token:  node scripts/import-item-emojis.js
 * Safe to re-run.
 */
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');

const TOKEN = process.env.BOT_TOKEN;
const APP_ID = process.env.CLIENT_ID;
const MAX_EMOJIS = 2000;
const ITEMS_DIR = path.join(__dirname, '..', 'assets', 'items');
const MAP_PATH = path.join(__dirname, '..', 'data', 'item-emojis.json');

async function main() {
  if (!TOKEN || !APP_ID) {
    console.error('BOT_TOKEN and CLIENT_ID must be set in .env');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(MAP_PATH), { recursive: true });

  const files = fs.readdirSync(ITEMS_DIR)
    .filter((f) => f.startsWith('minecraft_') && f.endsWith('.png'))
    .sort();
  console.log(`Found ${files.length} item icons in assets/items.`);

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  // Clear previously uploaded emojis (old runs used different icon sets).
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
  const used = new Set();
  let uploaded = 0;
  for (const file of files) {
    if (uploaded >= MAX_EMOJIS) {
      console.log(`Hit the ${MAX_EMOJIS} emoji cap, stopping.`);
      break;
    }
    const key = file.replace(/^minecraft_/, '').replace(/\.png$/, '').toLowerCase();
    let name = key.slice(0, 32).replace(/[^a-z0-9_]/g, '_');
    if (name.length < 2) name = `mc_${name}`;
    while (used.has(name)) name = `${name.slice(0, 29)}${Math.floor(Math.random() * 900 + 100)}`;
    used.add(name);

    const img = `data:image/png;base64,${fs.readFileSync(path.join(ITEMS_DIR, file)).toString('base64')}`;
    try {
      const created = await rest.post(Routes.applicationEmojis(APP_ID), { body: { name, image: img } });
      map[key] = `<:${name}:${created.id}>`;
      uploaded += 1;
      if (uploaded % 100 === 0) console.log(`  uploaded ${uploaded}...`);
    } catch (e) {
      console.warn(`  skip ${key}: ${e.message}`);
    }
  }

  fs.writeFileSync(MAP_PATH, JSON.stringify(map));
  console.log(`Done. Uploaded ${uploaded} emojis; map has ${Object.keys(map).length} entries.`);
  console.log('Now restart the bot: pm2 restart donut-index');
}

main().catch((e) => { console.error(e); process.exit(1); });
