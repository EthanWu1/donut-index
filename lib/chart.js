const { createCanvas } = require('@napi-rs/canvas');
const { formatNumber } = require('./format');

// Colours track the Discord dark-theme embed so the chart image reads as
// part of the embed rather than a separate graphic pasted into it.
const BG = '#2b2d31';   // Discord dark-theme embed background
const GRID = '#3a3c41'; // subtle horizontal rules
const AXIS = '#949ba4'; // Discord muted-text grey
const LINE = '#1abc9c'; // matches the history embed accent colour
const FILL = 'rgba(26, 188, 156, 0.10)'; // flat, faint fill under the line

// Font stack — prefers a modern face, falls back gracefully on any host.
const F = '"Segoe UI", "Helvetica Neue", "Noto Sans", Arial, sans-serif';

function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// points: [{ ts, value }] ascending by ts.
function renderChart(points) {
  const W = 1000;
  const H = 400;
  const padL = 96;
  const padR = 44;
  const padT = 28;
  const padB = 48;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Full-bleed background, no inner panel — the image blends into the embed.
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
  ctx.font = `400 13px ${F}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const v = minY + (spanY * i) / 4;
    const y = py(v);
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.fillStyle = AXIS;
    ctx.fillText(formatNumber(v), padL - 14, y);
  }

  // X labels
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = AXIS;
  for (const t of [minX, minX + spanX / 2, maxX]) {
    ctx.fillText(fmtDate(t), px(t), H - padB + 12);
  }

  // flat fill under the line (no glowing gradient)
  ctx.beginPath();
  ctx.moveTo(px(points[0].ts), padT + plotH);
  for (const p of points) ctx.lineTo(px(p.ts), py(p.value));
  ctx.lineTo(px(maxX), padT + plotH);
  ctx.closePath();
  ctx.fillStyle = FILL;
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
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  // latest-point marker — small, flat, no halo
  const last = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(px(last.ts), py(last.value), 4, 0, Math.PI * 2);
  ctx.fillStyle = LINE;
  ctx.fill();

  return canvas.toBuffer('image/png');
}

module.exports = { renderChart };
