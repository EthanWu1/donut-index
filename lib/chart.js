const { createCanvas } = require('@napi-rs/canvas');
const { formatNumber } = require('./format');
const config = require('../config');

// points: [{ ts, value }]. Returns a PNG Buffer.
function renderBalanceChart(points, label, startAtZero) {
  const W = 900, H = 420, pad = 60;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#1e1f22';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(label, pad, 34);

  if (points.length < 2) {
    ctx.fillStyle = '#9aa0a6';
    ctx.font = '16px sans-serif';
    ctx.fillText('Not enough history yet — check back later.', pad, H / 2);
    return canvas.toBuffer('image/png');
  }

  const xs = points.map((p) => p.ts);
  const ys = points.map((p) => p.value);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = startAtZero ? 0 : Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const px = (t) => pad + ((t - minX) / spanX) * (W - pad * 2);
  const py = (v) => H - pad - ((v - minY) / spanY) * (H - pad * 2);

  ctx.strokeStyle = '#3a3b3e';
  ctx.fillStyle = '#9aa0a6';
  ctx.font = '12px sans-serif';
  for (let i = 0; i <= 4; i++) {
    const v = minY + (spanY * i) / 4;
    const y = py(v);
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
    ctx.fillText(formatNumber(v), 6, y + 4);
  }

  ctx.strokeStyle = `#${config.embedColor.toString(16).padStart(6, '0')}`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = px(p.ts), y = py(p.value);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  return canvas.toBuffer('image/png');
}

module.exports = { renderBalanceChart };
