const test = require('node:test');
const assert = require('node:assert/strict');

const schematics = require('../commands/schematics');

test('schematic detail actions include materials and do not include rename', () => {
  const row = schematics._test.buildDetailActionRow({
    threadId: 'thread-1',
  }, 'all', 1, 'guild-1');

  const labels = row.toJSON().components.map((c) => c.label);
  assert.deepEqual(labels, ['Download', 'HoloPrint', 'Material List', 'View Post', 'Back']);
});

test('schematic file fetch retries the live attachment proxy and preserves spaces', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    calls.push(url);
    if (url.includes('expired')) {
      return { ok: false, status: 403, async arrayBuffer() { return Buffer.from(''); } };
    }
    return { ok: true, status: 200, async arrayBuffer() { return Buffer.from('schematic'); } };
  };

  const client = {
    channels: {
      async fetch(id) {
        assert.equal(id, 'thread-1');
        return {
          async fetchStarterMessage() {
            return {
              attachments: new Map([
                ['1', {
                  name: 'Mega Kelp Farm.litematic',
                  url: 'https://cdn.example/expired.litematic',
                  proxyURL: 'https://media.example/live.litematic',
                }],
              ]),
            };
          },
        };
      },
    },
  };

  try {
    const file = await schematics._test.fetchSchematicFile(client, 'thread-1');
    assert.equal(file.name, 'Mega Kelp Farm.litematic');
    assert.equal(file.buffer.toString(), 'schematic');
    assert.deepEqual(calls, [
      'https://cdn.example/expired.litematic',
      'https://media.example/live.litematic',
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});
