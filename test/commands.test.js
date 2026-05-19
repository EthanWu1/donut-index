const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ButtonStyle, MessageFlags } = require('discord.js');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'donutdex-commands-'));
const TMP = path.join(TMP_DIR, 'commands.sqlite');
process.env.DONUT_DB_PATH = TMP;

function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP + suffix); } catch {}
  }
  try { fs.rmdirSync(TMP_DIR); } catch {}
}
cleanup();
test.after(cleanup);

const db = require('../lib/db');
const pay = require('../commands/pay');
const unlink = require('../commands/unlink');

function userInteraction(userId = 'discord-user') {
  const calls = [];
  return {
    user: { id: userId },
    async reply(payload) { calls.push(['reply', payload]); },
    async update(payload) { calls.push(['update', payload]); },
    calls,
  };
}

test('/pay embed does not display the internal watch id', () => {
  const view = pay.payView({
    id: 'secret-watch-id',
    status: 'WATCHING',
    amount: 500000,
    payer_ign: 'Payer',
    receiver_ign: 'Receiver',
    created_at: Date.now(),
  });

  const embed = view.embeds[0].data;
  assert.strictEqual(embed.footer, undefined);
  assert.doesNotMatch(embed.description, /secret-watch-id/);
});

test('/unlink asks for confirmation with red unlink and gray cancel buttons', async () => {
  db.setLink('discord-user', 'PlayerOne');
  const interaction = userInteraction();

  await unlink.execute(interaction);

  assert.strictEqual(db.getLink('discord-user'), 'PlayerOne');
  assert.strictEqual(interaction.calls.length, 1);
  assert.strictEqual(interaction.calls[0][0], 'reply');
  const payload = interaction.calls[0][1];
  assert.strictEqual(payload.flags, MessageFlags.Ephemeral);
  assert.match(payload.content, /are you sure/i);

  const buttons = payload.components[0].toJSON().components;
  assert.deepStrictEqual(buttons.map((b) => b.label), ['Unlink', 'Cancel']);
  assert.deepStrictEqual(buttons.map((b) => b.style), [ButtonStyle.Danger, ButtonStyle.Secondary]);
});

test('/unlink confirm button removes the link', async () => {
  db.setLink('confirm-user', 'PlayerTwo');
  const interaction = userInteraction('confirm-user');
  interaction.customId = 'unlink:confirm';

  await unlink.button(interaction);

  assert.strictEqual(db.getLink('confirm-user'), null);
  assert.strictEqual(interaction.calls[0][0], 'update');
  assert.match(interaction.calls[0][1].content, /Unlinked from \*\*PlayerTwo\*\*/);
  assert.deepStrictEqual(interaction.calls[0][1].components, []);
});

test('/unlink cancel button keeps the link', async () => {
  db.setLink('cancel-user', 'PlayerThree');
  const interaction = userInteraction('cancel-user');
  interaction.customId = 'unlink:cancel';

  await unlink.button(interaction);

  assert.strictEqual(db.getLink('cancel-user'), 'PlayerThree');
  assert.strictEqual(interaction.calls[0][0], 'update');
  assert.match(interaction.calls[0][1].content, /kept linked/i);
  assert.deepStrictEqual(interaction.calls[0][1].components, []);
});
