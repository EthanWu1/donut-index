const { createCanvas } = require('@napi-rs/canvas');

const BG = '#202124';
const AXIS = '#787d87';
const VALUE = '#f4f5f7';
const LINE = '#1abc9c';
const LINE_DARK = '#117f73';
const BASELINE = '#30343a';
const GRID = '#2b2f35';
const CHART_COLORS = { line: LINE, lineDark: LINE_DARK, bg: BG };

const F = '"Segoe UI", "Helvetica Neue", "Noto Sans", Arial, sans-serif';
const MAX_POINTS = 72;

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

function chartTitle(points, opts = {}) {
  if (opts.title === 'latest') return chartSummary(points, opts).latestLabel;
  return opts.title || 'History';
}

function chartSubtitle(summary, opts = {}) {
  if (opts.subtitle === null || opts.subtitle === false) return '';
  return opts.subtitle
    || `Current ${summary.latestLabel}  Min ${summary.minLabel}  Max ${summary.maxLabel}  Change ${summary.deltaLabel}`;
}

function chartMarkers(points, opts = {}) {
  const clean = (points || [])
    .filter((p) => Number.isFinite(Number(p.value)) && Number.isFinite(Number(p.ts)))
    .map((p) => ({ ts: Number(p.ts), value: Number(p.value) }));
  if (clean.length === 0) return [];

  const minValue = Math.min(...clean.map((p) => p.value));
  const maxValue = Math.max(...clean.map((p) => p.value));
  const range = Math.max(1, maxValue - minValue);
  const out = [];
  const seen = new Set();
  const seenPoint = new Set();
  const add = (kind, point) => {
    const key = `${kind}:${point.ts}:${point.value}`;
    const pointKey = `${point.ts}:${point.value}`;
    if (seen.has(key) || seenPoint.has(pointKey)) return;
    seen.add(key);
    seenPoint.add(pointKey);
    out.push({
      kind,
      ts: point.ts,
      value: point.value,
      label: chartValueLabel(point.value, opts),
    });
  };

  add('first', clean[0]);
  add('latest', clean[clean.length - 1]);
  add('min', clean.reduce((a, b) => (a.value <= b.value ? a : b)));
  add('max', clean.reduce((a, b) => (a.value >= b.value ? a : b)));

  for (let i = 1; i < clean.length; i++) {
    const prev = clean[i - 1];
    const cur = clean[i];
    const delta = Math.abs(cur.value - prev.value);
    const pct = Math.abs(prev.value) > 0 ? delta / Math.abs(prev.value) : delta;
    if (delta >= range * 0.28 || pct >= 0.35) add('change', cur);
  }

  for (let i = 1; i < clean.length - 1; i++) {
    const prev = clean[i - 1].value;
    const cur = clean[i].value;
    const next = clean[i + 1].value;
    const turns = (cur > prev && cur > next) || (cur < prev && cur < next);
    if (turns && Math.abs(cur - prev) + Math.abs(next - cur) >= range * 0.18) add('turn', clean[i]);
  }

  return out
    .sort((a, b) => a.ts - b.ts || a.value - b.value)
    .slice(0, 10);
}

function rectsOverlap(a, b, gap = 0) {
  return a.x < b.x + b.w + gap
    && a.x + a.w + gap > b.x
    && a.y < b.y + b.h + gap
    && a.y + a.h + gap > b.y;
}

function layoutMarkerLabels(markers, points, dims = {}) {
  const W = dims.W || 1000;
  const H = dims.H || 440;
  const padL = dims.padL || 76;
  const padR = dims.padR || 40;
  const padT = dims.padT || 86;
  const padB = dims.padB || 56;
  const measure = dims.measure || ((label) => String(label || '').length * 7);
  const pts = (points || [])
    .filter((p) => Number.isFinite(Number(p.value)) && Number.isFinite(Number(p.ts)))
    .map((p) => ({ ts: Number(p.ts), value: Number(p.value) }));
  if (!pts.length) return [];

  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const minX = Math.min(...pts.map((p) => p.ts));
  const maxX = Math.max(...pts.map((p) => p.ts));
  const dataMax = Math.max(...pts.map((p) => p.value), 0);
  const yStep = niceCeil(((dataMax || 1) * 1.12) / 4);
  const maxY = yStep * 4;
  const spanX = (maxX - minX) || 1;
  const px = (t) => (maxX === minX ? padL + plotW / 2 : padL + ((t - minX) / spanX) * plotW);
  const py = (v) => padT + plotH - (v / maxY) * plotH;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const drawn = [];

  for (const marker of markers || []) {
    const p = pts.reduce((best, cur) =>
      (Math.abs(cur.ts - marker.ts) < Math.abs(best.ts - marker.ts) ? cur : best), pts[0]);
    const pointX = px(p.ts);
    const pointY = py(p.value);
    const w = Math.ceil(measure(marker.label)) + 14;
    const h = 18;
    const minRectX = padL + 2;
    const maxRectX = W - padR - w - 2;
    const minRectY = padT + 2;
    const maxRectY = H - padB - h - 2;
    const raw = [
      { x: pointX - w / 2, y: pointY - 28 },
      { x: pointX - w / 2, y: pointY + 13 },
      { x: pointX - w - 10, y: pointY - 9 },
      { x: pointX + 10, y: pointY - 9 },
      { x: pointX - w - 10, y: pointY - 30 },
      { x: pointX + 10, y: pointY - 30 },
      { x: pointX - w - 10, y: pointY + 12 },
      { x: pointX + 10, y: pointY + 12 },
    ];
    const candidates = raw.map((r) => ({
      x: clamp(r.x, minRectX, maxRectX),
      y: clamp(r.y, minRectY, maxRectY),
      w,
      h,
    }));
    for (let y = minRectY; y <= maxRectY; y += h + 5) {
      candidates.push({ x: clamp(pointX - w / 2, minRectX, maxRectX), y, w, h });
    }

    const placed = candidates.find((candidate) =>
      !drawn.some((rect) => rectsOverlap(candidate, rect, 4)));
    if (!placed) continue;
    drawn.push({
      ...placed,
      pointX,
      pointY,
      marker,
    });
  }
  return drawn;
}

function renderChart(points, opts = {}) {
  const W = 1000;
  const H = 440;
  const padL = 76;
  const padR = 40;
  const padT = (opts.subtitle === null || opts.subtitle === false) ? 72 : 86;
  const padB = 56;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  if (!points || points.length < 1) {
    ctx.fillStyle = AXIS;
    ctx.font = `400 17px ${F}`;
    ctx.textAlign = 'left';
    ctx.fillText('Not enough history yet - data builds up as the bot runs.', padL, H / 2);
    return canvas.toBuffer('image/png');
  }

  const pts = downsample(points
    .filter((p) => Number.isFinite(Number(p.value)) && Number.isFinite(Number(p.ts)))
    .map((p) => ({ ts: Number(p.ts), value: Number(p.value) })), MAX_POINTS);
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const minX = Math.min(...pts.map((p) => p.ts));
  const maxX = Math.max(...pts.map((p) => p.ts));
  const minY = 0;
  const dataMax = Math.max(...pts.map((p) => p.value), 0);
  const yStep = niceCeil(((dataMax || 1) * 1.12) / 4);
  const maxY = yStep * 4;
  const spanX = (maxX - minX) || 1;
  const spanY = maxY - minY;
  const px = (t) => (maxX === minX ? padL + plotW / 2 : padL + ((t - minX) / spanX) * plotW);
  const py = (v) => padT + plotH - ((v - minY) / spanY) * plotH;

  const summary = chartSummary(points, opts);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = VALUE;
  ctx.font = `700 25px ${F}`;
  ctx.fillText(chartTitle(pts, opts), padL, 35);
  const subtitle = chartSubtitle(summary, opts);
  if (subtitle) {
    ctx.fillStyle = AXIS;
    ctx.font = `500 13px ${F}`;
    ctx.fillText(subtitle, padL, 56);
  }

  ctx.font = `400 13px ${F}`;
  ctx.fillStyle = AXIS;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of [0, yStep, yStep * 2, yStep * 3, maxY]) {
    const y = py(v);
    ctx.fillText(opts.duration ? fmtDuration(v) : fmtAxis(v), padL - 12, py(v));
    ctx.strokeStyle = v === 0 ? BASELINE : GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
  }

  const xLabels = Math.min(6, pts.length);
  ctx.font = `400 12px ${F}`;
  ctx.fillStyle = '#686d76';
  ctx.textBaseline = 'top';
  for (let i = 0; i < xLabels; i++) {
    const p = pts[Math.round((pts.length - 1) * (i / Math.max(1, xLabels - 1)))];
    const x = px(p.ts);
    ctx.textAlign = i === 0 ? 'left' : i === xLabels - 1 ? 'right' : 'center';
    ctx.fillText(fmtDate(p.ts), x, H - padB + 19);
  }

  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = px(p.ts);
    const y = py(p.value);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = LINE_DARK;
  ctx.lineWidth = 6;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
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

  pts.forEach((p, i) => {
    if (pts.length > 36 && i % 2 && i !== pts.length - 1) return;
    const x = px(p.ts);
    const y = py(p.value);
    ctx.beginPath();
    ctx.arc(x, y, i === pts.length - 1 ? 4 : 2.4, 0, Math.PI * 2);
    ctx.fillStyle = i === pts.length - 1 ? VALUE : LINE;
    ctx.fill();
  });

  const drawLabel = (layout) => {
    const { marker, pointX: x, pointY: y } = layout;
    ctx.font = `700 11px ${F}`;
    roundedRect(ctx, layout.x, layout.y, layout.w, layout.h, 4);
    ctx.fillStyle = 'rgba(22, 24, 29, 0.86)';
    ctx.fill();
    ctx.strokeStyle = marker.kind === 'latest' ? 'rgba(255,255,255,0.55)' : 'rgba(26,188,156,0.58)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = VALUE;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(marker.label, layout.x + layout.w / 2, layout.y + layout.h / 2 + 0.5);

    ctx.beginPath();
    ctx.arc(x, y, marker.kind === 'latest' ? 4.6 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = VALUE;
    ctx.fill();
  };
  const labels = layoutMarkerLabels(chartMarkers(pts, opts), pts, {
    W,
    H,
    padL,
    padR,
    padT,
    padB,
    measure: (label) => ctx.measureText(label).width,
  });
  for (const label of labels) drawLabel(label);

  return canvas.toBuffer('image/png');
}

module.exports = {
  renderChart,
  chartSummary,
  chartMarkers,
  chartTitle,
  chartSubtitle,
  layoutMarkerLabels,
  rectsOverlap,
  CHART_COLORS,
};
