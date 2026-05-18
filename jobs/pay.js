const db = require('../lib/db');
const api = require('../lib/api');
const { payView } = require('../commands/pay');

// Polls the DonutSMP API for the payments /pay is watching. Watches live in
// the pay_watches table, so a restart simply resumes them on the next sweep.

const SWEEP_MS = 25_000;
let _client = null;

// Re-renders a watch's message in place (confirmed / expired / cancelled).
async function updateMessage(watch) {
  if (!_client || !watch.channel_id || !watch.message_id) return;
  try {
    const channel = await _client.channels.fetch(watch.channel_id);
    const message = await channel.messages.fetch(watch.message_id);
    await message.edit(payView(watch));
  } catch {
    // Message deleted or unreachable — the watch still resolves in the DB.
  }
}

async function sweepWatch(w) {
  if (Date.now() > w.expires_at) {
    db.setWatchStatus(w.id, 'EXPIRED');
    await updateMessage(db.getWatch(w.id));
    return;
  }
  let payerNow;
  let receiverNow;
  try {
    payerNow = await api.getBalance(w.payer_ign);
    receiverNow = await api.getBalance(w.receiver_ign);
  } catch {
    return; // transient API issue — try again next sweep
  }
  // Confirmed once the payer has lost at least the amount and the receiver has
  // gained at least the amount since the watch started.
  const sent = w.payer_start - payerNow;
  const received = receiverNow - w.receiver_start;
  if (sent >= w.amount && received >= w.amount) {
    db.setWatchStatus(w.id, 'PAID');
    await updateMessage(db.getWatch(w.id));
  }
}

async function sweep() {
  db.clearExpiredPendingLinks();
  for (const w of db.watchesByStatus('WATCHING')) {
    try {
      await sweepWatch(w);
    } catch (err) {
      console.error(`[pay] watch ${w.id} sweep failed:`, err.message);
    }
  }
}

function startPayJob(client) {
  _client = client;
  sweep().catch((err) => console.error('[pay] initial sweep failed:', err.message));
  setInterval(() => sweep().catch((err) => console.error('[pay]', err.message)), SWEEP_MS);
}

module.exports = { startPayJob };
