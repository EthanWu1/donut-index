const { createCanvas } = require('@napi-rs/canvas');

// Tuned to sit inside a Discord dark embed: same background, almost no chrome,
// one accent colour. The headline value doubles as the chart's title.
const BG = '#2b2d31';
const AXIS = '#80848e';      // muted axis labels
const VALUE = '#f2f3f5';     // the big headline number
const LINE = '#1abc9c';      // teal accent (matches the history embed)
const BASELINE = '#3a3c41';  // one faint rule along the x-axis

const F = '"Segoe UI", "Helvetica Neue", "Noto Sans", Arial, sans-serif';
const MAX_POINTS = 48;       // downsample target — keeps the line legible
const DOT_LIMIT = 24;        // step dots only show when the series is short

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Compact axis label with no trailing zeros: 40000 -> "40K", 1500 -> "1.5K".
function fmtAxis(v) {
  if (!v) return '0';
  const [div, suffix] = Math.abs(v) >= 1e9 ? [1e9, 'B']
    : Math.abs(v) >= 1e6 ? [1e6, 'M']
      : Math.abs(v) >= 1e3 ? [1e3, 'K'] : [1, ''];
  return `${(v / div).toFixed(2).replace(/\.?0+$/, '')}${suffix}`;
}

// Smallest "nice" number >= x (1/1.5/2/... * 10^n), for round axis labels.
function niceCeil(x) {
  if (!(x > 0)) return 1;
  const base = 10 ** Math.floor(Math.log10(x));
  const f = x / base;
  for (const t of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (f <= t) return t * base;
  }
  return 10 * base;
}

// Even-spaced downsample that always keeps the first and last point.
function downsample(points, max) {
  if (points.length <= max) return points;
  const out = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

// points: [{ ts, value }] ascending by ts. opts.money prefixes the headline $.
function renderChart(points, opts = {}) {
  const W = 1000;
  const H = 440;
  const padL = 72;
  const padR = 40;
  const padT = 116; // room for the headline value above the plot
  const padB = 46;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  if (!points || points.length < 2) {
    ctx.fillStyle = AXIS;
    ctx.font = `400 17px ${F}`;
    ctx.textAlign = 'left';
    ctx.fillText('Not enough history yet — data builds up as the bot runs.', padL, H / 2);
    return canvas.toBuffer('image/png');
  }

  const pts = downsample(points, MAX_POINTS);
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const minX = Math.min(...pts.map((p) => p.ts));
  const maxX = Math.max(...pts.map((p) => p.ts));
  // Round the axis to nice numbers: two even steps from 0, the top step a
  // little above the data so the peak isn't flush to the edge.
  const minY = 0;
  const dataMax = Math.max(...pts.map((p) => p.value), 0);
  const yStep = niceCeil(((dataMax || 1) * 1.1) / 2);
  const maxY = yStep * 2;
  const spanX = (maxX - minX) || 1;
  const spanY = maxY - minY;
  const px = (t) => padL + ((t - minX) / spanX) * plotW;
  const py = (v) => padT + plotH - ((v - minY) / spanY) * plotH;

  // Headline value — the latest point, large, top-left. This is the title.
  const latest = points[points.length - 1].value;
  const headline = opts.money
    ? `$${Math.round(latest).toLocaleString('en-US')}`
    : Math.round(latest).toLocaleString('en-US');
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = VALUE;
  ctx.font = `600 48px ${F}`;
  ctx.fillText(headline, padL, 70);

  // Y labels — three round numbers down the left edge, no grid lines.
  ctx.font = `400 13px ${F}`;
  ctx.fillStyle = AXIS;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of [0, yStep, maxY]) {
    ctx.fillText(fmtAxis(v), padL - 12, py(v));
  }

  // One faint baseline along the bottom of the plot.
  ctx.strokeStyle = BASELINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, py(minY));
  ctx.lineTo(W - padR, py(minY));
  ctx.stroke();

  // The line — straight segments, no area fill, no glow.
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

  // Step dots at each sampled point (only when the series is short enough to
  // stay clean); the latest point is always marked and emphasised.
  const showDots = pts.length <= DOT_LIMIT;
  pts.forEach((p, i) => {
    const last = i === pts.length - 1;
    if (!last && !showDots) return;
    const x = px(p.ts);
    const y = py(p.value);
    if (last) {
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fillStyle = BG;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = LINE;
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = LINE;
      ctx.fill();
    }
  });

  // X labels — just the first and last date, in the bottom corners.
  ctx.font = `400 13px ${F}`;
  ctx.fillStyle = AXIS;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(fmtDate(minX), padL, H - padB + 14);
  ctx.textAlign = 'right';
  ctx.fillText(fmtDate(maxX), W - padR, H - padB + 14);

  return canvas.toBuffer('image/png');
}

module.exports = { renderChart };
