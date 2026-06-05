const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'donutdex-interaction-'));
const TMP = path.join(TMP_DIR, 'interaction.sqlite');
process.env.DONUT_DB_PATH = TMP;

function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP + suffix); } catch {}
  }
  try { fs.rmdirSync(TMP_DIR); } catch {}
}
cleanup();
test.after(cleanup);

const interactionCreate = require('../events/interactionCreate');
const api = require('../lib/api');
const config = require('../config');

function chatInputInteraction(command) {
  const calls = [];
  return {
    commandName: 'stats',
    client: { commands: new Map([['stats', command]]) },
    user: { id: 'discord-user' },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    isButton: () => false,
    async editReply(payload) { calls.push(['editReply', payload]); },
    async reply(payload) { calls.push(['reply', payload]); },
    calls,
  };
}

function buttonInteraction(command) {
  const calls = [];
  return {
    customId: 'leaderboard:page:money:2',
    client: { commands: new Map([['leaderboard', command]]) },
    deferred: false,
    replied: false,
    isChatInputCommand: () => false,
    isAutocomplete: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    isButton: () => true,
    async editReply(payload) { calls.push(['editReply', payload]); },
    async reply(payload) {
      calls.push(['reply', payload]);
      if (this.deferred || this.replied) throw new Error('interaction already acknowledged');
    },
    calls,
  };
}

test('API errors in slash commands send a service unavailable error embed', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const interaction = chatInputInteraction({
      async execute(i) {
        i.deferred = true;
        throw new api.ApiError('Network error: socket hang up');
      },
    });

    await interactionCreate.execute(interaction);

    assert.strictEqual(interaction.calls.length, 1);
    assert.strictEqual(interaction.calls[0][0], 'editReply');
    const payload = interaction.calls[0][1];
    assert.strictEqual(payload.embeds[0].data.color, config.colors.error);
    assert.match(payload.embeds[0].data.description, /service is not available/i);
    assert.match(payload.embeds[0].data.description, /DonutSMP API/i);
  } finally {
    console.error = originalError;
  }
});

test('API errors after deferred button interactions do not replace the current reply', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const interaction = buttonInteraction({
      async button(i) {
        i.deferred = true;
        throw new api.ApiError('HTTP 500: upstream failed');
      },
    });

    await interactionCreate.execute(interaction);

    assert.strictEqual(interaction.calls.length, 0);
  } finally {
    console.error = originalError;
  }
});
