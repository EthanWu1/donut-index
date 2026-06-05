const test = require('node:test');
const assert = require('node:assert');

const render = require('../commands/render');

const materials = [
  { key: 'stone', name: 'Stone', count: 130, stacks: 3 },
  { key: 'oak_log', name: 'Oak Log', count: 64, stacks: 1 },
];

test('/render message includes material list and estimated cost buttons', () => {
  const payload = render.buildMessage({
    png: Buffer.from([1, 2, 3]),
    meta: { name: 'Build', blockCount: 194, size: { x: 4, y: 5, z: 6 }, materials },
    token: 'abc',
  });

  const buttons = payload.components.flatMap((row) => row.toJSON().components).map((b) => b.label);
  assert.ok(buttons.includes('Material List'));
  assert.ok(buttons.includes('Estimated Cost'));
});

test('estimated render cost prices whole stacks from lowest AH stack price', () => {
  const estimate = render.estimateMaterialCost(materials, [
    { key: 'stone', amount: 64, price: 320 },
    { key: 'stone', amount: 16, price: 160 },
    { key: 'oak_log', amount: 64, price: 128 },
  ]);

  assert.strictEqual(estimate.total, 1088);
  assert.strictEqual(estimate.lines[0].stackPrice, 320);
  assert.strictEqual(estimate.lines[0].cost, 960);
});
