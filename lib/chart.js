const { createCanvas } = require('@napi-rs/canvas');
const { formatNumber } = require('./format');

const BG = '#1e1f22';
const PANEL = '#232428';
const GRID = '#2e3035';
const TEXT = '#b5bac1';
const TITLE = '#ffffff';
const LINE = '#e89b5a';
const FILL_TOP = 'rgba(232, 155, 90, 0.38)';
const FILL_BOT = 'rgba(232, 155, 90, 0.02)';

function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// points: [{ ts, value }] ascending by ts. opts: { title, startAtZero }
function renderChart(points, opts = {}) {
  const { title = '', startAtZero = true } = opts;
  const W = 1000;
  const H = 460;
  const padL = 92;
  const padR = 40;
  const padT = 66;
  const padB = 54;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = TITLE;
  ctx.font = 'bold 23px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(title, padL, 40);

  if (!points || points.length < 2) {
    ctx.fillStyle = TEXT;
    ctx.font = '16px sans-serif';
    ctx.fillText('Not enough history yet — data builds up as the bot runs.', padL, H / 2);
    return canvas.toBuffer('image/png');
  }

  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  // plot panel
  ctx.fillStyle = PANEL;
  ctx.fillRect(padL, padT, plotW, plotH);

  const xs = points.map((p) => p.ts);
  const ys = points.map((p) => p.value);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  let minY = startAtZero ? 0 : Math.min(...ys);
  let maxY = Math.max(...ys);
  if (minY === maxY) maxY = minY + 1;
  const headroom = (maxY - minY) * 0.08;
  maxY += headroom;
  if (!startAtZero) minY -= headroom;
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const px = (t) => padL + ((t - minX) / spanX) * plotW;
  const py = (v) => padT + plotH - ((v - minY) / spanY) * plotH;

  // horizontal grid + Y axis labels
  ctx.font = '13px sans-serif';
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
    ctx.fillStyle = TEXT;
    ctx.fillText(formatNumber(v), padL - 12, y);
  }

  // X axis labels
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = TEXT;
  for (const t of [minX, minX + spanX / 2, maxX]) {
    ctx.fillText(fmtDate(t), px(t), H - padB + 12);
  }

  // area fill under the line
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

  // the line
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = px(p.ts);
    const y = py(p.value);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  // marker on the latest point
  const last = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(px(last.ts), py(last.value), 5.5, 0, Math.PI * 2);
  ctx.fillStyle = LINE;
  ctx.fill();
  ctx.strokeStyle = BG;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

module.exports = { renderChart };
