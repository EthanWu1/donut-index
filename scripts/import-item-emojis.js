/*
 * One-time importer: downloads the official Minecraft client jar, extracts
 * every item/block texture, and uploads them as Discord application emojis.
 * Writes data/item-emojis.json (item key -> "<:name:id>").
 *
 * Run on the host that has the bot token:  node scripts/import-item-emojis.js
 * Safe to re-run: existing emojis are detected and skipped (resumes).
 * Requires `unzip` on the system (the deploy guide already installs it).
 */
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const { REST, Routes } = require('discord.js');

const TOKEN = process.env.BOT_TOKEN;
const APP_ID = process.env.CLIENT_ID;
const MAX_EMOJIS = 1900; // Discord app-emoji cap is 2000; leave headroom.
const TMP = path.join(__dirname, '..', '.emoji-tmp');
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
  fs.mkdirSync(TMP, { recursive: true });
  fs.mkdirSync(path.dirname(MAP_PATH), { recursive: true });

  console.log('Resolving latest Minecraft release...');
  const manifest = JSON.parse((await get('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json')).toString());
  const ver = manifest.versions.find((v) => v.id === manifest.latest.release);
  const verMeta = JSON.parse((await get(ver.url)).toString());
  const jarUrl = verMeta.downloads.client.url;

  console.log(`Downloading client jar (${manifest.latest.release})...`);
  const jarPath = path.join(TMP, 'client.jar');
  fs.writeFileSync(jarPath, await get(jarUrl));

  console.log('Extracting textures...');
  try {
    execFileSync('unzip', [
      '-o', '-q', jarPath,
      'assets/minecraft/textures/item/*',
      'assets/minecraft/textures/block/*',
      '-d', TMP,
    ]);
  } catch (e) {
    // unzip exits non-zero if one pattern matched nothing; tolerate it.
    if (!fs.existsSync(path.join(TMP, 'assets/minecraft/textures/item'))) throw e;
  }

  const dirs = [
    path.join(TMP, 'assets/minecraft/textures/item'),
    path.join(TMP, 'assets/minecraft/textures/block'),
  ];
  const files = [];
  const seen = new Set();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      if (!f.endsWith('.png')) continue;
      const key = f.replace(/\.png$/, '').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      files.push({ key, full: path.join(dir, f) });
    }
  }
  console.log(`Found ${files.length} unique textures.`);

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const existingRes = await rest.get(Routes.applicationEmojis(APP_ID));
  const existing = existingRes.items || existingRes || [];
  const byName = new Map(existing.map((e) => [e.name, e.id]));
  console.log(`${byName.size} application emojis already exist.`);

  const map = {};
  let count = byName.size;
  let uploaded = 0;

  for (const { key, full } of files) {
    const name = key.slice(0, 32).replace(/[^a-z0-9_]/gi, '_');
    if (byName.has(name)) {
      map[key] = `<:${name}:${byName.get(name)}>`;
      continue;
    }
    if (count >= MAX_EMOJIS) continue;
    const dataUri = `data:image/png;base64,${fs.readFileSync(full).toString('base64')}`;
    try {
      const created = await rest.post(Routes.applicationEmojis(APP_ID), { body: { name, image: dataUri } });
      map[key] = `<:${name}:${created.id}>`;
      byName.set(name, created.id);
      count += 1;
      uploaded += 1;
      if (uploaded % 50 === 0) console.log(`  uploaded ${uploaded} (total ${count})...`);
    } catch (e) {
      console.warn(`  skip ${key}: ${e.message}`);
    }
  }

  fs.writeFileSync(MAP_PATH, JSON.stringify(map));
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`Done. Uploaded ${uploaded} new emojis; map has ${Object.keys(map).length} entries.`);
  console.log('Now restart the bot: pm2 restart donut-index');
}

main().catch((e) => { console.error(e); process.exit(1); });
