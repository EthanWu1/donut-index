const { createCanvas } = require('@napi-rs/canvas');
const { comparisonRows } = require('./compareStats');

const W = 1000;
const H = 560;
const BG = '#2b2d31';
const PANEL = '#34363c';
const TEXT = '#f2f3f5';
const MUTED = '#b5bac1';
const ACCENT = '#1abc9c';
const GOLD = '#f1b32e';
const F = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

function renderCompareCard(firstName, firstStats, secondName, secondStats) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = TEXT;
  ctx.font = `700 42px ${F}`;
  ctx.fillText(`${firstName} vs ${secondName}`, 54, 70);
  ctx.fillStyle = MUTED;
  ctx.font = `400 18px ${F}`;
  ctx.fillText('DonutSMP stat comparison', 56, 100);

  const rows = comparisonRows(firstName, firstStats, secondName, secondStats);
  const x = 54;
  let y = 132;
  const rowH = 42;
  rows.forEach((row, i) => {
    ctx.fillStyle = i % 2 === 0 ? PANEL : '#303238';
    ctx.fillRect(x, y - 26, W - 108, rowH - 4);
    const label = row.replace(/\*\*/g, '').replace(/[()]/g, '');
    ctx.fillStyle = label.includes('Tie') ? MUTED : (label.includes(`${firstName} by`) ? ACCENT : GOLD);
    ctx.font = `600 18px ${F}`;
    ctx.fillText(label.slice(0, 104), x + 18, y);
    y += rowH;
  });

  return canvas.toBuffer('image/png');
}

module.exports = { renderCompareCard };
