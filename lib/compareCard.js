const { createCanvas } = require('@napi-rs/canvas');
const { comparisonEntries } = require('./compareStats');

const W = 1080;
const H = 720;
const BG = '#1f2024';
const SURFACE = '#272a30';
const ROW = '#2f333a';
const ROW_ALT = '#292d33';
const LINE = '#3b4048';
const TEXT = '#f2f3f5';
const MUTED = '#a3a9b4';
const LEFT = '#47c7b4';
const RIGHT = '#d8789a';
const TIE = '#c7a65a';
const F = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

function roundedRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function fitText(ctx, text, width) {
  const input = String(text || '');
  if (ctx.measureText(input).width <= width) return input;
  let out = input;
  while (out.length > 1 && ctx.measureText(`${out}...`).width > width) out = out.slice(0, -1);
  return `${out}...`;
}

function renderScore(ctx, x, y, label, value, color) {
  ctx.fillStyle = MUTED;
  ctx.font = `700 12px ${F}`;
  ctx.textAlign = 'center';
  ctx.fillText(label, x, y);
  ctx.fillStyle = color;
  ctx.font = `800 34px ${F}`;
  ctx.fillText(String(value), x, y + 38);
}

function renderCompareCard(firstName, firstStats, secondName, secondStats) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const rows = comparisonEntries(firstName, firstStats, secondName, secondStats);
  const firstWins = rows.filter((r) => r.winner === 'first').length;
  const secondWins = rows.filter((r) => r.winner === 'second').length;
  const ties = rows.filter((r) => r.winner === 'tie').length;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = TEXT;
  ctx.font = `800 34px ${F}`;
  ctx.textAlign = 'center';
  ctx.fillText('Player Compare', W / 2, 48);

  ctx.font = `700 24px ${F}`;
  ctx.textAlign = 'left';
  ctx.fillText(fitText(ctx, firstName, 330), 64, 94);
  ctx.textAlign = 'right';
  ctx.fillText(fitText(ctx, secondName, 330), W - 64, 94);

  renderScore(ctx, W / 2 - 95, 80, 'LEFT', firstWins, LEFT);
  renderScore(ctx, W / 2, 80, 'TIE', ties, TIE);
  renderScore(ctx, W / 2 + 95, 80, 'RIGHT', secondWins, RIGHT);

  const x = 50;
  const y = 136;
  const tableW = W - 100;
  const rowH = 50;
  roundedRect(ctx, x, y, tableW, 552, 8);
  ctx.fillStyle = SURFACE;
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = MUTED;
  ctx.font = `800 12px ${F}`;
  ctx.textAlign = 'left';
  ctx.fillText(firstName.toUpperCase(), x + 28, y + 31);
  ctx.textAlign = 'center';
  ctx.fillText('STAT', W / 2, y + 31);
  ctx.textAlign = 'right';
  ctx.fillText(secondName.toUpperCase(), x + tableW - 28, y + 31);

  rows.forEach((row, index) => {
    const yy = y + 42 + index * rowH;
    ctx.fillStyle = index % 2 ? ROW_ALT : ROW;
    ctx.fillRect(x + 1, yy, tableW - 2, rowH);

    const leftColor = row.winner === 'first' ? LEFT : TEXT;
    const rightColor = row.winner === 'second' ? RIGHT : TEXT;
    const centerColor = row.winner === 'tie' ? TIE : MUTED;

    ctx.font = `800 19px ${F}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = leftColor;
    ctx.fillText(row.firstLabel, x + 28, yy + 31);

    ctx.textAlign = 'right';
    ctx.fillStyle = rightColor;
    ctx.fillText(row.secondLabel, x + tableW - 28, yy + 31);

    ctx.textAlign = 'center';
    ctx.fillStyle = TEXT;
    ctx.font = `800 16px ${F}`;
    ctx.fillText(row.label, W / 2, yy + 22);

    ctx.fillStyle = centerColor;
    ctx.font = `600 12px ${F}`;
    const note = row.winner === 'tie'
      ? 'Tie'
      : `${row.winner === 'first' ? firstName : secondName} by ${row.diffLabel}`;
    ctx.fillText(fitText(ctx, note, 260), W / 2, yy + 39);
  });

  ctx.fillStyle = MUTED;
  ctx.font = `500 13px ${F}`;
  ctx.textAlign = 'center';
  ctx.fillText('Deaths: lower is better. Every other stat: higher is better.', W / 2, H - 24);

  return canvas.toBuffer('image/png');
}

module.exports = { renderCompareCard };
