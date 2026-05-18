// One-off: renders a sample image-based /stats card for iEtZ.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'donut-index' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(res.headers.location));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const c = [];
      res.on('data', (d) => c.push(d));
      res.on('end', () => resolve(Buffer.concat(c)));
    }).on('error', reject);
  });
}

const W = 900;
const H = 520;
const EMBED = '#2b2d31';      // Discord dark-theme embed body
const TEXT = '#f2f3f5';
const SUB = '#b5bac1';
const MUTED = '#80848e';
const DIV = '#3f4147';
const UP = '#3ba55d';
const DOWN = '#ed4245';
const ONLINE = false;
const ACCENT = ONLINE ? '#3ba55d' : '#ed4245';
const F = '"Segoe UI", Arial, sans-serif';
const ITEMS = path.join(__dirname, '..', 'assets', 'items');

const STATS = [
  { label: 'Balance', value: '1.76M', delta: '2.96B', up: false, icon: 'emerald' },
  { label: 'Shards', value: '5.69K', delta: '4.53K', up: true, icon: 'amethyst_shard' },
  { label: 'Kills', value: '44', delta: '2', up: true, icon: 'diamond_sword' },
  { label: 'Deaths', value: '120', delta: '6', up: true, icon: 'skeleton_skull' },
  { label: 'Playtime', value: '48d 13h', delta: '90h 40m', up: true, icon: 'clock' },
  { label: 'Blocks Placed', value: '349.66K', delta: '5.29K', up: true, icon: 'stone' },
  { label: 'Blocks Broken', value: '155.07K', delta: '6.09K', up: true, icon: 'cobblestone' },
  { label: 'Mobs Killed', value: '642', delta: '81', up: true, icon: 'zombie_head' },
  { label: 'Money Spent', value: '232.48M', delta: '10.97M', up: true, icon: 'gold_nugget' },
  { label: 'Money Made', value: '4.79B', delta: '1.98B', up: true, icon: 'iron_nugget' },
];

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function maybeIcon(name) {
  const p = path.join(ITEMS, `minecraft_${name}.png`);
  try { return fs.existsSync(p) ? await loadImage(p) : null; }
  catch { return null; }
}

(async () => {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // embed body with rounded corners; canvas corners stay transparent so the
  // card blends onto the Discord message background like a real embed.
  roundRect(ctx, 0, 0, W, H, 14);
  ctx.fillStyle = EMBED;
  ctx.fill();
  // left accent bar, clipped to the embed shape
  ctx.save();
  roundRect(ctx, 0, 0, W, H, 14);
  ctx.clip();
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, 5, H);
  ctx.restore();

  const padL = 34;
  const padR = 30;
  ctx.textBaseline = 'alphabetic';

  // header: head thumbnail top-right
  let head = null;
  try { head = await loadImage(await get('https://mc-heads.net/avatar/iEtZ/96')); } catch { /* fallback */ }
  if (head) {
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    roundRect(ctx, W - padR - 84, 26, 84, 84, 10);
    ctx.clip();
    ctx.drawImage(head, W - padR - 84, 26, 84, 84);
    ctx.restore();
  }

  // status dot + title
  ctx.fillStyle = ACCENT;
  ctx.beginPath();
  ctx.arc(padL + 8, 52, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = TEXT;
  ctx.font = `bold 30px ${F}`;
  ctx.fillText("iEtZ's Statistics", padL + 28, 62);
  ctx.fillStyle = SUB;
  ctx.font = `15px ${F}`;
  ctx.fillText('iEtZ is currently offline!   ·   Last seen a month ago', padL + 28, 90);

  // divider under header
  ctx.fillStyle = DIV;
  ctx.fillRect(padL, 116, W - padL - padR, 1);

  // stat grid: 2 columns x 5 rows, flat (no inner boxes)
  for (const s of STATS) s._icon = await maybeIcon(s.icon);
  ctx.imageSmoothingEnabled = false;
  const colGap = 34;
  const colW = (W - padL - padR - colGap) / 2;
  const top = 140;
  const rowH = 64;
  STATS.forEach((s, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = padL + col * (colW + colGap);
    const y = top + row * rowH;
    const cy = y + rowH / 2;

    // icon
    const icon = s._icon;
    if (icon) ctx.drawImage(icon, x, cy - 17, 34, 34);
    else {
      ctx.fillStyle = '#4a4d54';
      roundRect(ctx, x, cy - 15, 30, 30, 6);
      ctx.fill();
    }
    // label + value
    ctx.fillStyle = MUTED;
    ctx.font = `600 11px ${F}`;
    ctx.fillText(s.label.toUpperCase(), x + 48, cy - 7);
    ctx.fillStyle = TEXT;
    ctx.font = `bold 22px ${F}`;
    ctx.fillText(s.value, x + 48, cy + 18);
    // delta, right-aligned in the column
    ctx.fillStyle = s.up ? UP : DOWN;
    ctx.font = `600 14px ${F}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${s.up ? '▲' : '▼'} ${s.up ? '+' : '-'}${s.delta}`, x + colW, cy + 6);
    ctx.font = `11px ${F}`;
    ctx.fillStyle = MUTED;
    ctx.fillText('past 24h', x + colW, cy + 22);
    ctx.textAlign = 'left';
  });

  // footer
  const fy = top + 5 * rowH + 6;
  ctx.fillStyle = DIV;
  ctx.fillRect(padL, fy, W - padL - padR, 1);
  ctx.fillStyle = MUTED;
  ctx.font = `600 12px ${F}`;
  ctx.fillText('DONUT INDEX', padL, fy + 26);
  ctx.textAlign = 'right';
  ctx.font = `12px ${F}`;
  ctx.fillText('Today at 4:52 PM', W - padR, fy + 26);
  ctx.textAlign = 'left';

  fs.writeFileSync('C:/Users/ethan/OneDrive/Desktop/ietz-stat-card-sample.png', canvas.toBuffer('image/png'));
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
