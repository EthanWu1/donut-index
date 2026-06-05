const test = require('node:test');
const assert = require('node:assert');

const messageCreate = require('../events/messageCreate');

test('! prefix dispatches read-only command message handlers', async () => {
  const calls = [];
  const command = {
    async messageExecute(message, args) {
      calls.push({ content: message.content, args });
      await message.reply({ content: 'ok' });
    },
  };
  const replies = [];
  const message = {
    content: '!stats PlayerOne',
    author: { bot: false },
    client: { commands: new Map([['stats', command]]) },
    async reply(payload) { replies.push(payload); },
  };

  await messageCreate.execute(message);

  assert.deepStrictEqual(calls[0].args, ['PlayerOne']);
  assert.strictEqual(replies[0].content, 'ok');
});

test('! prefix ignores slash-only commands', async () => {
  const replies = [];
  const message = {
    content: '!pay Player 100',
    author: { bot: false },
    client: { commands: new Map([['pay', {}]]) },
    async reply(payload) { replies.push(payload); },
  };

  await messageCreate.execute(message);

  assert.strictEqual(replies.length, 0);
});

test('! prefix falls back to channel send when replying is blocked', async () => {
  const sent = [];
  const message = {
    content: '!stats PlayerOne',
    author: { bot: false },
    client: {
      commands: new Map([['stats', {
        async execute(interaction) {
          await interaction.reply({ content: 'ok' });
        },
      }]]),
    },
    async reply() {
      const err = new Error('Missing Permissions');
      err.code = 50013;
      throw err;
    },
    channel: {
      async send(payload) { sent.push(payload); },
    },
  };

  await messageCreate.execute(message);

  assert.strictEqual(sent[0].content, 'ok');
});
