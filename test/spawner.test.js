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

  assert.ok(Math.abs(blazeRate - boneRate * 5) <= 5);
});

test('spawner price parser supports commas and suffixes', () => {
  assert.strictEqual(spawner.parsePrice('1,250'), 1250);
  assert.strictEqual(spawner.parsePrice('1.5k'), 1500);
  assert.strictEqual(spawner.parsePrice('2m'), 2000000);
  assert.strictEqual(spawner.parsePrice(''), 0);
});

test('spawner view renders manually entered profit per drop and total', () => {
  const payload = spawner.view('skeleton', 1000, 0, { bone: 2, arrow: 1 });
  const description = payload.embeds[0].data.description;

  assert.match(description, /\*\*Bones:\*\*.*\$[0-9,]+`\/hour/);
  assert.match(description, /\*\*Arrows:\*\*.*\$[0-9,]+`\/hour/);
  assert.match(description, /\*\*Total Profit:\*\*.*\$[0-9,]+`\/hour/);
});

test('spawner price button opens a price modal for the selected drops', async () => {
  const calls = [];
  const interaction = {
    customId: 'spawner:p:skeleton:1000:0',
    async showModal(modal) { calls.push(modal); },
  };

  await spawner.button(interaction);

  assert.strictEqual(calls.length, 1);
  const modal = calls[0].toJSON();
  assert.strictEqual(modal.custom_id, 'spawner:pm:skeleton:1000:0:');
  assert.deepStrictEqual(
    modal.components.map((row) => row.components[0].custom_id),
    ['bone', 'arrow'],
  );
});

test('spawner price modal re-renders the current view with profit mode', async () => {
  const calls = [];
  const interaction = {
    customId: 'spawner:pm:skeleton:1000:0:',
    fields: {
      getTextInputValue(id) {
        return id === 'bone' ? '2' : '1';
      },
    },
    async update(payload) { calls.push(payload); },
  };

  await spawner.modal(interaction);

  assert.strictEqual(calls.length, 1);
  assert.match(calls[0].embeds[0].data.description, /\*\*Total Profit:\*\*/);
});

test('spawner derived production and profit values round down', () => {
  const payload = spawner.view('skeleton', 1, 1, { bone: 1, arrow: 1 });
  const description = payload.embeds[0].data.description;
  const boneLine = description.split('\n').find((line) => line.includes('**Bones:**'));
  const arrowLine = description.split('\n').find((line) => line.includes('**Arrows:**'));

  assert.doesNotMatch(boneLine, /`3`\/min/);
  assert.doesNotMatch(arrowLine, /`2`\/min/);
  assert.match(boneLine, /`2`\/min/);
  assert.match(arrowLine, /`1`\/min/);
});
