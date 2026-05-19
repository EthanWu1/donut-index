const test = require('node:test');
const assert = require('node:assert');

const api = require('../lib/api');
const config = require('../config');
const auction = require('../jobs/auction');
const ah = require('../commands/ah');

function interactionWithOption(value = '') {
  const calls = [];
  return {
    options: { getString: () => value },
    async reply(payload) { calls.push(['reply', payload]); },
    calls,
  };
}

test('/ah shows service unavailable when the auction API rebuild returns no listings', async () => {
  const originals = {
    getAuctionTransactions: api.getAuctionTransactions,
    getAuctionList: api.getAuctionList,
    ahTxnPages: config.ahTxnPages,
    ahMaxPages: config.ahMaxPages,
    warn: console.warn,
    log: console.log,
  };
  console.warn = () => {};
  console.log = () => {};
  config.ahTxnPages = 1;
  config.ahMaxPages = 1;
  api.getAuctionTransactions = async () => [];
  api.getAuctionList = async () => [];

  try {
    await auction.rebuild();
    const interaction = interactionWithOption('');

    await ah.execute(interaction);

    assert.strictEqual(interaction.calls.length, 1);
    const payload = interaction.calls[0][1];
    assert.match(payload.embeds[0].data.description, /service is not available/i);
    assert.deepStrictEqual(payload.components, []);
  } finally {
    api.getAuctionTransactions = originals.getAuctionTransactions;
    api.getAuctionList = originals.getAuctionList;
    config.ahTxnPages = originals.ahTxnPages;
    config.ahMaxPages = originals.ahMaxPages;
    console.warn = originals.warn;
    console.log = originals.log;
  }
});
