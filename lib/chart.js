const { createCanvas } = require('@napi-rs/canvas');
const { formatNumber } = require('./format');

const BG = '#16171a';
const PANEL = '#1f2023';
const GRID = '#2b2d31';
const AXIS = '#8a8f98';
const TITLE = '#f2f3f5';
const LINE = '#26c6a8';
const FILL_TOP = 'rgba(38, 198, 168, 0.34)';
const FILL_BOT = 'rgba(38, 198, 168, 0.00)';

// Font stack — prefers a modern face, falls back gracefully on any host.
const F = '"Segoe UI", "Helvetica Neue", "Noto Sans", Arial, sans-serif';

function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// points: [{ ts, value }] ascending by ts. opts: { title }
function renderChart(points) {
  const W = 1000;
  const H = 400;
  const padL = 96;
  const padR = 44;
  const padT = 34;
  const padB = 56;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  if (!points || points.length < 2) {
    ctx.fillStyle = AXIS;
    ctx.font = `400 16px ${F}`;
    ctx.fillText('Not enough history yet. Data builds up as the bot runs.', padL, H / 2);
    return canvas.toBuffer('image/png');
  }

  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  ctx.fillStyle = PANEL;
  roundRect(ctx, padL, padT, plotW, plotH, 10);
  ctx.fill();

  const xs = points.map((p) => p.ts);
  const ys = points.map((p) => p.value);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = 0;
  let maxY = Math.max(...ys);
  if (maxY === minY) maxY = minY + 1;
  maxY += (maxY - minY) * 0.12;
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const px = (t) => padL + ((t - minX) / spanX) * plotW;
  const py = (v) => padT + plotH - ((v - minY) / spanY) * plotH;

  // horizontal grid + Y labels
  ctx.font = `500 13px ${F}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const v = minY + (spanY * i) / 4;
    const y = py(v);
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL + 1, y);
    ctx.lineTo(W - padR - 1, y);
    ctx.stroke();
    ctx.fillStyle = AXIS;
    ctx.fillText(formatNumber(v), padL - 14, y);
  }

  // X labels
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = AXIS;
  for (const t of [minX, minX + spanX / 2, maxX]) {
    ctx.fillText(fmtDate(t), px(t), H - padB + 14);
  }

  // area fill
  const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
  grad.addColorStop(0, FILL_TOP);
  grad.addColorStop(1, FILL_BOT);
  ctx.beginPath();
  ctx.moveTo(px(points[0].ts), padT + plotH);
  for (const p of points) ctx.lineTo(px(p.ts), py(p.value));
  ctx.lineTo(px(maxX), padT + plotH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // line
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = px(p.ts);
    const y = py(p.value);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 3.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  // latest-point marker
  const last = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(px(last.ts), py(last.value), 6, 0, Math.PI * 2);
  ctx.fillStyle = LINE;
  ctx.fill();
  ctx.strokeStyle = BG;
  ctx.lineWidth = 3;
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

module.exports = { renderChart };
