/*
 * Resumable importer: uploads the bundled item icons (assets/items/) as
 * Discord application emojis and writes data/item-emojis.json.
 *
 * Run on the host with the bot token:  node scripts/import-item-emojis.js
 * It is fully resumable: if it stops (reboot, disconnect, rate limit), just
 * run it again and it continues from where it left off. Progress is tracked
 * in data/.emoji-state.json. Delete that file to force a clean re-import.
 */
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');

const TOKEN = process.env.BOT_TOKEN;
const APP_ID = process.env.CLIENT_ID;
const MAX_EMOJIS = 2000;

// Discord hard-throttles application-emoji create/delete once a fast
// burst trips its anti-abuse system, and the penalty escalates the more
// you hammer it. A steady pause between every op keeps the sustained
// rate under that radar. Override with EMOJI_DELAY_MS if needed.
const DELAY_MS = Number(process.env.EMOJI_DELAY_MS) || 2500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ITEMS_DIR = path.join(__dirname, '..', 'assets', 'items');
const MAP_PATH = path.join(__dirname, '..', 'data', 'item-emojis.json');
const STATE_PATH = path.join(__dirname, '..', 'data', '.emoji-state.json');
const LOCK_PATH = path.join(__dirname, '..', 'data', '.emoji-import.lock');

// Refuse to run if another import is already running (two processes sharing
// the token hammer Discord and get the whole token throttled).
function acquireLock() {
  if (fs.existsSync(LOCK_PATH)) {
    const pid = Number(fs.readFileSync(LOCK_PATH, 'utf8'));
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch { alive = false; }
    if (alive) {
      console.error(`Another import is already running (pid ${pid}). Aborting.`);
      console.error('Kill it first:  pkill -f import-item-emojis');
      process.exit(1);
    }
  }
  fs.writeFileSync(LOCK_PATH, String(process.pid));
  process.on('exit', () => { try { fs.unlinkSync(LOCK_PATH); } catch { /* ignore */ } });
}

const MIME = { '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
const PRIORITY = { '.webp': 0, '.gif': 1, '.png': 2 }; // animated formats first

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
  catch { return { uploaded: {} }; }
}
function saveState(s) { fs.writeFileSync(STATE_PATH, JSON.stringify(s)); }
function saveMap(uploaded) {
  const map = {};
  for (const [k, v] of Object.entries(uploaded)) map[k] = v.tag;
  fs.writeFileSync(MAP_PATH, JSON.stringify(map));
}

async function main() {
  if (!TOKEN || !APP_ID) {
    console.error('BOT_TOKEN and CLIENT_ID must be set in .env');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(MAP_PATH), { recursive: true });
  acquireLock();

  // Build target list: item key -> candidate files, animated formats first.
  const byKey = {};
  for (const f of fs.readdirSync(ITEMS_DIR)) {
    const m = /^minecraft_(.+)\.(png|gif|webp)$/i.exec(f);
    if (!m) continue;
    const key = m[1].toLowerCase();
    (byKey[key] = byKey[key] || []).push(f);
  }
  for (const k of Object.keys(byKey)) {
    byKey[k].sort((a, b) => PRIORITY[path.extname(a).toLowerCase()] - PRIORITY[path.extname(b).toLowerCase()]);
  }
  const keys = Object.keys(byKey).sort();
  console.log(`${keys.length} target items in assets/items.`);

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const state = loadState();

  const existingRes = await rest.get(Routes.applicationEmojis(APP_ID));
  const existing = existingRes.items || existingRes || [];
  const ourIds = new Set(Object.values(state.uploaded).map((v) => v.id));

  // Delete emojis that are not part of the current target set. A full
  // delete is intentional: the new icon set changes textures, so old
  // emojis cannot be reused even when the item name matches.
  const junk = existing.filter((e) => !ourIds.has(e.id));
  if (junk.length) {
    console.log(`Deleting ${junk.length} old emojis...`);
    let del = 0;
    for (const e of junk) {
      try {
        await rest.delete(Routes.applicationEmoji(APP_ID, e.id));
        del += 1;
        if (del % 100 === 0) console.log(`  deleted ${del}/${junk.length}...`);
      } catch (err) {
        // 10014 = already gone (stale list); not a real failure.
        if (err.code !== 10014) console.warn(`  delete ${e.name}: ${err.message}`);
        else del += 1;
      }
      await sleep(DELAY_MS);
    }
    console.log(`Deleted ${del} old emojis.`);
  }

  // Upload any target not yet uploaded.
  const usedNames = new Set(Object.values(state.uploaded).map((v) => v.name));
  let total = Object.keys(state.uploaded).length;
  let added = 0;
  for (const key of keys) {
    if (state.uploaded[key]) continue;
    if (total >= MAX_EMOJIS) { console.log(`Hit the ${MAX_EMOJIS} emoji cap.`); break; }

    let name = key.slice(0, 32).replace(/[^a-z0-9_]/g, '_');
    if (name.length < 2) name = `mc_${name}`;
    while (usedNames.has(name)) name = `${name.slice(0, 29)}${Math.floor(Math.random() * 900 + 100)}`;

    let done = false;
    for (const file of byKey[key]) {
      const ext = path.extname(file).toLowerCase();
      const buf = fs.readFileSync(path.join(ITEMS_DIR, file));
      const img = `data:${MIME[ext]};base64,${buf.toString('base64')}`;
      try {
        const created = await rest.post(Routes.applicationEmojis(APP_ID), { body: { name, image: img } });
        const tag = `<${created.animated ? 'a' : ''}:${name}:${created.id}>`;
        state.uploaded[key] = { name, id: created.id, tag };
        usedNames.add(name);
        total += 1;
        added += 1;
        done = true;
        if (added % 50 === 0) {
          saveState(state);
          saveMap(state.uploaded);
          console.log(`  uploaded ${added} this run (${total} total)...`);
        }
        break;
      } catch (err) {
        console.warn(`  ${key} via ${file}: ${err.message}`);
      }
    }
    if (!done) console.warn(`  skip ${key}: all formats failed`);
    await sleep(DELAY_MS);
  }

  saveState(state);
  saveMap(state.uploaded);
  const remaining = keys.filter((k) => !state.uploaded[k]).length;
  console.log(`This run: +${added} uploaded, ${total} total, ${remaining} still missing.`);
  if (remaining > 0) {
    console.log('Not finished. Run this script again to continue.');
  } else {
    console.log('Complete. Restart the bot: pm2 restart donut-index');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
