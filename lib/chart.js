const { createCanvas } = require('@napi-rs/canvas');

const BG = '#2b2d31';
const AXIS = '#80848e';
const VALUE = '#f2f3f5';
const LINE = '#1abc9c';
const BASELINE = '#3a3c41';

const F = '"Segoe UI", "Helvetica Neue", "Noto Sans", Arial, sans-serif';
const MAX_POINTS = 48;
const DOT_LIMIT = 24;

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtDuration(totalSeconds) {
  let s = Math.max(0, Math.trunc(Number(totalSeconds) || 0));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (!d && !h && m) parts.push(`${m}m`);
  if (parts.length === 0) parts.push('0m');
  return parts.join(' ');
}

function fmtAxis(v) {
  if (!v) return '0';
  const [div, suffix] = Math.abs(v) >= 1e9 ? [1e9, 'B']
    : Math.abs(v) >= 1e6 ? [1e6, 'M']
      : Math.abs(v) >= 1e3 ? [1e3, 'K'] : [1, ''];
  return `${(v / div).toFixed(2).replace(/\.?0+$/, '')}${suffix}`;
}

function niceCeil(x) {
  if (!(x > 0)) return 1;
  const base = 10 ** Math.floor(Math.log10(x));
  const f = x / base;
  for (const t of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (f <= t) return t * base;
  }
  return 10 * base;
}

function downsample(points, max) {
  if (points.length <= max) return points;
  const out = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

function chartValueLabel(value, opts = {}) {
  if (opts.duration) return fmtDuration(value);
  if (opts.money) return `$${Math.round(value).toLocaleString('en-US')}`;
  return Math.round(value).toLocaleString('en-US');
}

function chartSummary(points, opts = {}) {
  const clean = (points || []).filter((p) => Number.isFinite(Number(p.value)));
  if (clean.length === 0) {
    return {
      latestLabel: '0', minLabel: '0', maxLabel: '0', deltaLabel: '0',
    };
  }
  const first = clean[0].value;
  const latest = clean[clean.length - 1].value;
  const min = Math.min(...clean.map((p) => p.value));
  const max = Math.max(...clean.map((p) => p.value));
  const delta = latest - first;
  return {
    latest,
    min,
    max,
    delta,
    latestLabel: chartValueLabel(latest, opts),
    minLabel: chartValueLabel(min, opts),
    maxLabel: chartValueLabel(max, opts),
    deltaLabel: `${delta > 0 ? '+' : delta < 0 ? '-' : ''}${chartValueLabel(Math.abs(delta), opts)}`,
  };
}

function renderChart(points, opts = {}) {
  const W = 1000;
  const H = 440;
  const padL = 72;
  const padR = 40;
  const padT = 116;
  const padB = 46;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  if (!points || points.length < 2) {
    ctx.fillStyle = AXIS;
    ctx.font = `400 17px ${F}`;
    ctx.textAlign = 'left';
    ctx.fillText('Not enough history yet - data builds up as the bot runs.', padL, H / 2);
    return canvas.toBuffer('image/png');
  }

  const pts = downsample(points, MAX_POINTS);
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const minX = Math.min(...pts.map((p) => p.ts));
  const maxX = Math.max(...pts.map((p) => p.ts));
  const minY = 0;
  const dataMax = Math.max(...pts.map((p) => p.value), 0);
  const yStep = niceCeil(((dataMax || 1) * 1.1) / 2);
  const maxY = yStep * 2;
  const spanX = (maxX - minX) || 1;
  const spanY = maxY - minY;
  const px = (t) => padL + ((t - minX) / spanX) * plotW;
  const py = (v) => padT + plotH - ((v - minY) / spanY) * plotH;

  const summary = chartSummary(points, opts);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = VALUE;
  ctx.font = `600 48px ${F}`;
  ctx.fillText(summary.latestLabel, padL, 70);
  ctx.fillStyle = AXIS;
  ctx.font = `400 15px ${F}`;
  ctx.fillText(`Min ${summary.minLabel}   Max ${summary.maxLabel}   Change ${summary.deltaLabel}`, padL, 96);

  ctx.font = `400 13px ${F}`;
  ctx.fillStyle = AXIS;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of [0, yStep, maxY]) {
    ctx.fillText(opts.duration ? fmtDuration(v) : fmtAxis(v), padL - 12, py(v));
  }

  ctx.strokeStyle = BASELINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, py(minY));
  ctx.lineTo(W - padR, py(minY));
  ctx.stroke();

  ctx.beginPath();
  pts.forEach((p, i) => {
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

  const showDots = pts.length <= DOT_LIMIT;
  pts.forEach((p, i) => {
    const last = i === pts.length - 1;
    if (!last && !showDots) return;
    const x = px(p.ts);
    const y = py(p.value);
    ctx.beginPath();
    ctx.arc(x, y, last ? 5 : 2.6, 0, Math.PI * 2);
    ctx.fillStyle = last ? VALUE : LINE;
    ctx.fill();
  });

  const extrema = [
    pts.reduce((a, b) => (a.value <= b.value ? a : b)),
    pts.reduce((a, b) => (a.value >= b.value ? a : b)),
  ];
  for (const p of extrema) {
    ctx.beginPath();
    ctx.arc(px(p.ts), py(p.value), 4, 0, Math.PI * 2);
    ctx.fillStyle = '#f1b32e';
    ctx.fill();
  }

  ctx.font = `400 13px ${F}`;
  ctx.fillStyle = AXIS;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(fmtDate(minX), padL, H - padB + 14);
  ctx.textAlign = 'right';
  ctx.fillText(fmtDate(maxX), W - padR, H - padB + 14);

  return canvas.toBuffer('image/png');
}

module.exports = { renderChart, chartSummary };
