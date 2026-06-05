const { Events } = require('discord.js');
const { executePrefixCommand, sendMessageOutput } = require('../lib/prefix');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message || !message.content || (message.author && message.author.bot)) return;
    try {
      await executePrefixCommand(message);
    } catch (err) {
      console.error(`[prefix ${message.content}]`, err);
      await sendMessageOutput(message, { content: 'Command failed. Try the slash-command version if this keeps happening.' }).catch(() => {});
    }
  },
};
