const test = require('node:test');
const assert = require('node:assert');

const spawner = require('../commands/spawner');

function interaction({ type, count = 1000 }) {
  const calls = [];
  return {
    options: {
      getInteger(name) { return name === 'spawners' ? count : null; },
      getString(name) { return name === 'type' ? type : null; },
    },
    async reply(payload) { calls.push(payload); },
    calls,
  };
}

async function render(type, count = 1000) {
  const i = interaction({ type, count });
  await spawner.execute(i);
  assert.strictEqual(i.calls.length, 1);
  return i.calls[0].embeds[0].data.description;
}

function perMinute(description, dropName) {
  const escaped = dropName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\*\\*${escaped}:\\*\\*\\s+\`([0-9,]+)\`/min`).exec(description);
  assert.ok(match, `Missing ${dropName} rate in:\n${description}`);
  return match[1];
}

test('/spawner choices include zombie and zombified piglin', () => {
  const json = spawner.data.toJSON();
  const typeOption = json.options.find((o) => o.name === 'type');
  const values = typeOption.choices.map((c) => c.value);

  assert.ok(values.includes('zombie'));
  assert.ok(values.includes('zombified_piglin'));
});

test('/spawner zombie renders rotten flesh at the 1.5x rate', async () => {
  const zombie = await render('zombie');
  const cow = await render('cow');

  assert.match(zombie, /Zombie Spawner Production/);
  assert.strictEqual(perMinute(zombie, 'Rotten Flesh'), perMinute(cow, 'Raw Beef'));
});

test('/spawner zombified piglin renders gold nuggets and rotten flesh rates', async () => {
  const piglin = await render('zombified_piglin');
  const cow = await render('cow');
  const spider = await render('spider');

  assert.match(piglin, /Zombified Piglin Spawner Production/);
  assert.strictEqual(perMinute(piglin, 'Gold Nuggets'), perMinute(cow, 'Raw Beef'));
  assert.strictEqual(perMinute(piglin, 'Rotten Flesh'), perMinute(spider, 'String'));
});

test('/spawner blaze renders blaze powder at the 5x rate', async () => {
  const blaze = await render('blaze');
  const skeleton = await render('skeleton');
  const boneRate = Number(perMinute(skeleton, 'Bones').replace(/,/g, ''));
  const blazeRate = Number(perMinute(blaze, 'Blaze Powder').replace(/,/g, ''));

  assert.ok(Math.abs(blazeRate - boneRate * 5) <= 1);
});
