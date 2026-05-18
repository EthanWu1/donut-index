const UNITS = [
  { v: 1e12, s: 'T' },
  { v: 1e9, s: 'B' },
  { v: 1e6, s: 'M' },
  { v: 1e3, s: 'K' },
];

function formatNumber(n) {
  const num = Number(n) || 0;
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);
  for (const u of UNITS) {
    if (abs >= u.v) {
      // always two decimals (e.g. 273.50M) to match the in-game stat style
      return sign + (abs / u.v).toFixed(2) + u.s;
    }
  }
  return sign + String(Math.trunc(abs));
}

function formatDuration(totalSeconds) {
  let s = Math.max(0, Math.trunc(Number(totalSeconds) || 0));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m || parts.length === 0) parts.push(`${m}m`);
  return parts.join(' ');
}

function formatDelta(current, previous) {
  const diff = (Number(current) || 0) - (Number(previous) || 0);
  const up = diff > 0;
  const down = diff < 0;
  const text = (up ? '+' : '') + formatNumber(diff);
  return { text, up, down };
}

function relativeTime(then, now = Date.now()) {
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 30) return 'just now';
  if (sec < 90) return 'a minute ago';
  const min = Math.round(sec / 60);
  if (min < 45) return `${min} minutes ago`;
  const hr = Math.round(sec / 3600);
  if (hr < 2) return 'an hour ago';
  if (hr < 24) return `${hr} hours ago`;
  const day = Math.round(sec / 86400);
  if (day < 2) return 'a day ago';
  if (day < 30) return `${day} days ago`;
  const mon = Math.round(day / 30);
  if (mon < 2) return 'a month ago';
  if (mon < 12) return `${mon} months ago`;
  const yr = Math.round(day / 365);
  return yr < 2 ? 'a year ago' : `${yr} years ago`;
}

module.exports = { formatNumber, formatDuration, formatDelta, relativeTime };
