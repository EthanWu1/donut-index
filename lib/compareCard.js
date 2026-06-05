const { createCanvas } = require('@napi-rs/canvas');
const { comparisonEntries } = require('./compareStats');

const W = 1280;
const H = 900;
const BG = '#202124';
const PANEL = '#262930';
const PANEL_2 = '#2d3138';
const GRID = '#383d45';
const TEXT = '#f4f5f7';
const MUTED = '#9aa1ad';
const LEFT = '#33d6c0';
const RIGHT = '#ff4f86';
const GOLD = '#f1b32e';
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

function fitText(ctx, text, maxWidth) {
  const s = String(text || '');
  if (ctx.measureText(s).width <= maxWidth) return s;
  let out = s;
  while (out.length > 1 && ctx.measureText(`${out}...`).width > maxWidth) out = out.slice(0, -1);
  return `${out}...`;
}

function renderHeader(ctx, x, y, w, name, wins, color, align = 'left') {
  roundedRect(ctx, x, y, w, 120, 8);
  ctx.fillStyle = PANEL;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = align;
  ctx.fillStyle = TEXT;
  ctx.font = `800 38px ${F}`;
  ctx.fillText(fitText(ctx, name, w - 56), align === 'left' ? x + 28 : x + w - 28, y + 48);
  ctx.fillStyle = MUTED;
  ctx.font = `600 15px ${F}`;
  ctx.fillText(`${wins} stat${wins === 1 ? '' : 's'} ahead`, align === 'left' ? x + 30 : x + w - 30, y + 78);

  roundedRect(ctx, align === 'left' ? x + 28 : x + w - 116, y + 88, 88, 26, 6);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = BG;
  ctx.font = `800 14px ${F}`;
  ctx.textAlign = 'center';
  ctx.fillText(`${wins} WINS`, align === 'left' ? x + 72 : x + w - 72, y + 106);
}

function renderCompareCard(firstName, firstStats, secondName, secondStats) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const entries = comparisonEntries(firstName, firstStats, secondName, secondStats);
  const firstWins = entries.filter((e) => e.winner === 'first').length;
  const secondWins = entries.filter((e) => e.winner === 'second').length;
  const ties = entries.filter((e) => e.winner === 'tie').length;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 0, 80, W / 2, 0, 720);
  glow.addColorStop(0, 'rgba(255,79,134,0.20)');
  glow.addColorStop(0.55, 'rgba(51,214,192,0.10)');
  glow.addColorStop(1, 'rgba(32,33,36,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = TEXT;
  ctx.font = `800 34px ${F}`;
  ctx.textAlign = 'center';
  ctx.fillText('Player Comparison', W / 2, 48);
  ctx.fillStyle = MUTED;
  ctx.font = `500 15px ${F}`;
  ctx.fillText(`${firstName} vs ${secondName}`, W / 2, 72);

  renderHeader(ctx, 58, 98, 430, firstName, firstWins, LEFT, 'left');
  renderHeader(ctx, W - 488, 98, 430, secondName, secondWins, RIGHT, 'right');

  roundedRect(ctx, W / 2 - 86, 112, 172, 84, 8);
  ctx.fillStyle = '#17191d';
  ctx.fill();
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = GOLD;
  ctx.font = `800 30px ${F}`;
  ctx.textAlign = 'center';
  ctx.fillText(`${ties}`, W / 2, 150);
  ctx.fillStyle = MUTED;
  ctx.font = `600 13px ${F}`;
  ctx.fillText('TIED STATS', W / 2, 173);

  const tableX = 58;
  const tableY = 250;
  const tableW = W - 116;
  const rowH = 58;
  roundedRect(ctx, tableX, tableY - 34, tableW, rowH * entries.length + 48, 8);
  ctx.fillStyle = 'rgba(23,25,29,0.76)';
  ctx.fill();
  ctx.strokeStyle = GRID;
  ctx.stroke();

  ctx.font = `700 12px ${F}`;
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'left';
  ctx.fillText(firstName.toUpperCase(), tableX + 24, tableY - 12);
  ctx.textAlign = 'center';
  ctx.fillText('STAT', W / 2, tableY - 12);
  ctx.textAlign = 'right';
  ctx.fillText(secondName.toUpperCase(), tableX + tableW - 24, tableY - 12);

  entries.forEach((entry, i) => {
    const y = tableY + i * rowH;
    ctx.fillStyle = i % 2 === 0 ? PANEL : PANEL_2;
    ctx.fillRect(tableX + 1, y, tableW - 2, rowH - 1);

    const max = Math.max(Math.abs(entry.firstValue), Math.abs(entry.secondValue), 1);
    const leftRatio = Math.max(0.06, Math.abs(entry.firstValue) / max);
    const rightRatio = Math.max(0.06, Math.abs(entry.secondValue) / max);
    const barW = 228;
    const barY = y + 34;

    ctx.fillStyle = '#17191d';
    ctx.fillRect(tableX + 170, barY, barW, 6);
    ctx.fillRect(W - tableX - 170 - barW, barY, barW, 6);
    ctx.fillStyle = entry.winner === 'first' ? LEFT : 'rgba(51,214,192,0.45)';
    ctx.fillRect(tableX + 170 + barW * (1 - leftRatio), barY, barW * leftRatio, 6);
    ctx.fillStyle = entry.winner === 'second' ? RIGHT : 'rgba(255,79,134,0.45)';
    ctx.fillRect(W - tableX - 170 - barW, barY, barW * rightRatio, 6);

    ctx.font = `800 20px ${F}`;
    ctx.fillStyle = entry.winner === 'first' ? LEFT : TEXT;
    ctx.textAlign = 'left';
    ctx.fillText(entry.firstLabel, tableX + 24, y + 29);
    ctx.fillStyle = entry.winner === 'second' ? RIGHT : TEXT;
    ctx.textAlign = 'right';
    ctx.fillText(entry.secondLabel, tableX + tableW - 24, y + 29);

    ctx.fillStyle = TEXT;
    ctx.font = `800 17px ${F}`;
    ctx.textAlign = 'center';
    ctx.fillText(entry.label, W / 2, y + 25);
    ctx.fillStyle = MUTED;
    ctx.font = `500 12px ${F}`;
    const winner = entry.winner === 'tie'
      ? 'Tie'
      : `${entry.winner === 'first' ? firstName : secondName} +${entry.diffLabel}`;
    ctx.fillText(fitText(ctx, winner, 260), W / 2, y + 43);
  });

  ctx.fillStyle = MUTED;
  ctx.font = `500 13px ${F}`;
  ctx.textAlign = 'center';
  ctx.fillText('Lower deaths wins. All other stats favor the higher value.', W / 2, H - 28);

  return canvas.toBuffer('image/png');
}

module.exports = { renderCompareCard };
