const PREFIX = '!';

const PREFIX_COMMANDS = new Set([
  'help', 'stats', 'compare', 'history', 'rank', 'leaderboard',
  'ah', 'price', 'worth', 'spawner', 'render', 'holoprint',
]);

function parsePrefix(content) {
  const text = String(content || '').trim();
  if (!text.startsWith(PREFIX)) return null;
  const [nameRaw, ...args] = text.slice(PREFIX.length).trim().split(/\s+/).filter(Boolean);
  if (!nameRaw) return null;
  return { name: nameRaw.toLowerCase(), args };
}

function firstAttachment(message) {
  const attachments = message.attachments;
  if (!attachments) return null;
  if (typeof attachments.first === 'function') return attachments.first();
  if (Array.isArray(attachments)) return attachments[0] || null;
  if (attachments instanceof Map) return attachments.values().next().value || null;
  return null;
}

function optionFacade(name, args, message) {
  const joined = args.join(' ');
  return {
    getString(option) {
      if (name === 'compare') {
        if (option === 'first') return args[0] || null;
        if (option === 'second') return args[1] || null;
      }
      if (name === 'leaderboard' && option === 'type') return args[0] || 'money';
      if (name === 'spawner' && option === 'type') return args[1] || null;
      if (['ah', 'price', 'worth', 'history'].includes(name) && option === 'item') return joined || null;
      if (['stats', 'rank'].includes(name) && option === 'username') return args[0] || null;
      return null;
    },
    getInteger(option) {
      if (name === 'spawner' && option === 'spawners') return Number(args[0]) || null;
      return null;
    },
    getUser() { return null; },
    getAttachment(option) {
      if ((name === 'render' || name === 'holoprint') && option === 'litematic') return firstAttachment(message);
      return null;
    },
  };
}

function cleanPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const out = { ...payload };
  delete out.flags;
  return out;
}

async function sendMessageOutput(message, payload) {
  const clean = cleanPayload(payload);
  try {
    return await message.reply(clean);
  } catch (err) {
    if (message.channel && typeof message.channel.send === 'function') {
      return message.channel.send(clean);
    }
    throw err;
  }
}

function interactionFacade(message, name, args) {
  return {
    user: message.author,
    member: message.member,
    channel: message.channel,
    guild: message.guild,
    client: message.client,
    commandName: name,
    options: optionFacade(name, args, message),
    deferred: false,
    replied: false,
    async deferReply() { this.deferred = true; },
    async reply(payload) {
      this.replied = true;
      return sendMessageOutput(message, payload);
    },
    async editReply(payload) {
      this.replied = true;
      return sendMessageOutput(message, payload);
    },
    async followUp(payload) {
      return sendMessageOutput(message, payload);
    },
  };
}

async function executePrefixCommand(message, parsed = parsePrefix(message.content)) {
  if (!parsed || !PREFIX_COMMANDS.has(parsed.name)) return false;
  const command = message.client.commands.get(parsed.name);
  if (!command) return false;
  if (command.messageExecute) {
    await command.messageExecute(message, parsed.args);
    return true;
  }
  if (!command.execute) return false;
  await command.execute(interactionFacade(message, parsed.name, parsed.args));
  return true;
}

module.exports = {
  PREFIX,
  PREFIX_COMMANDS,
  parsePrefix,
  executePrefixCommand,
  interactionFacade,
  sendMessageOutput,
};
