const { createCanvas } = require('@napi-rs/canvas');
const { formatNumber, formatDuration } = require('./format');

const W = 1000;
const H = 520;
const BG = '#202225';
const PANEL = '#2b2d31';
const PANEL_2 = '#34373d';
const TEXT = '#f2f3f5';
const MUTED = '#b5bac1';
const GREEN = '#3ba55d';
const RED = '#ed4245';
const GOLD = '#f1b32e';
const TEAL = '#1abc9c';
const F = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

function drawRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function statCard(ctx, x, y, w, h, label, value, accent = TEAL) {
  drawRoundRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = PANEL_2;
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.fillRect(x, y, 5, h);
  ctx.fillStyle = MUTED;
  ctx.font = `500 19px ${F}`;
  ctx.fillText(label, x + 22, y + 31);
  ctx.fillStyle = TEXT;
  ctx.font = `700 31px ${F}`;
  ctx.fillText(value, x + 22, y + 72);
}

function renderProfileCard(ign, data) {
  const { stats, online, location, playtimeSec } = data;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  drawRoundRect(ctx, 32, 32, W - 64, H - 64, 22);
  ctx.fillStyle = PANEL;
  ctx.fill();

  ctx.fillStyle = online ? GREEN : RED;
  ctx.fillRect(32, 32, W - 64, 8);

  drawRoundRect(ctx, 72, 86, 118, 118, 18);
  ctx.fillStyle = '#111214';
  ctx.fill();
  ctx.fillStyle = GOLD;
  ctx.font = `800 58px ${F}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(ign || '?').slice(0, 2).toUpperCase(), 131, 145);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = TEXT;
  ctx.font = `800 48px ${F}`;
  ctx.fillText(ign, 220, 126);

  ctx.fillStyle = online ? GREEN : RED;
  ctx.font = `700 24px ${F}`;
  ctx.fillText(online ? `Online${location ? ` in ${location}` : ''}` : 'Offline', 222, 166);

  ctx.fillStyle = MUTED;
  ctx.font = `500 20px ${F}`;
  ctx.fillText('DonutSMP profile', 222, 197);

  const playtime = formatDuration(playtimeSec || 0);
  statCard(ctx, 72, 242, 200, 92, 'Balance', `$${formatNumber(stats.money)}`, GOLD);
  statCard(ctx, 292, 242, 200, 92, 'Shards', formatNumber(stats.shards), TEAL);
  statCard(ctx, 512, 242, 200, 92, 'Kills / Deaths', `${formatNumber(stats.kills)} / ${formatNumber(stats.deaths)}`, RED);
  statCard(ctx, 732, 242, 196, 92, 'Playtime', playtime, GREEN);

  statCard(ctx, 72, 360, 200, 92, 'Blocks Placed', formatNumber(stats.placed));
  statCard(ctx, 292, 360, 200, 92, 'Blocks Broken', formatNumber(stats.broken));
  statCard(ctx, 512, 360, 200, 92, 'Mobs Killed', formatNumber(stats.mobs));
  statCard(ctx, 732, 360, 196, 92, 'Shop / Sell', `$${formatNumber(stats.spent)} / $${formatNumber(stats.made)}`, GOLD);

  return canvas.toBuffer('image/png');
}

module.exports = { renderProfileCard };
