const { ChannelType } = require('discord.js');
const config = require('./../config');

// Donut Index does not manage schematics — donutbot already publishes them as
// threads in its schematic forum channel (each starter message carries the
// body, a render image and the .litematic file). This job periodically scans
// that forum and indexes every thread that has at least one forum tag applied.
// Untagged threads are intentionally skipped: a tag is the "show this" gate.

let schematics = [];   // [{ threadId, name, tags:[{id,name}], litematicUrl, litematicName, renderUrl, body, archived, createdAt }]
let tagList = [];      // [{ id, name }] from the forum's availableTags
let guildId = null;
let updatedAt = 0;
let building = false;
let _client = null;

function getSchematicIndex() {
  return { schematics, tags: tagList, guildId, updatedAt, building };
}

// Active threads + every page of archived threads (forum posts auto-archive,
// so most schematics live in the archived set).
async function fetchAllThreads(forum) {
  const out = [];
  try {
    const active = await forum.threads.fetchActive();
    for (const t of active.threads.values()) out.push(t);
  } catch (e) {
    console.warn('[schematics] active fetch:', e.message);
  }
  let before;
  for (let i = 0; i < 50; i++) {
    let page;
    try {
      page = await forum.threads.fetchArchived({ limit: 100, before });
    } catch (e) {
      console.warn('[schematics] archived fetch:', e.message);
      break;
    }
    const threads = [...page.threads.values()];
    for (const t of threads) out.push(t);
    if (!page.hasMore || threads.length === 0) break;
    before = threads[threads.length - 1].id;
  }
  return out;
}

function pickAttachments(starter) {
  let litematicUrl = null;
  let litematicName = null;
  let renderUrl = null;
  if (starter) {
    for (const a of starter.attachments.values()) {
      const name = (a.name || '').toLowerCase();
      if (name.endsWith('.litematic')) {
        litematicUrl = a.url;
        litematicName = a.name;
      } else if (!renderUrl && /\.(png|jpe?g|webp|gif)$/.test(name)) {
        renderUrl = a.url;
      }
    }
  }
  return { litematicUrl, litematicName, renderUrl };
}

async function rebuild() {
  if (building || !_client) return;
  building = true;
  try {
    const forumId = config.schematicForumChannelId;
    const forum = await _client.channels.fetch(forumId).catch(() => null);
    if (!forum || forum.type !== ChannelType.GuildForum) {
      console.warn(`[schematics] channel ${forumId} is unreachable or not a forum channel`);
      return;
    }
    guildId = forum.guildId;
    tagList = (forum.availableTags || []).map((t) => ({ id: t.id, name: t.name }));
    const tagById = new Map(tagList.map((t) => [t.id, t]));

    const threads = await fetchAllThreads(forum);
    const out = [];
    for (const thread of threads) {
      const applied = thread.appliedTags || [];
      if (applied.length === 0) continue; // only tagged threads are listed
      const starter = await thread.fetchStarterMessage().catch(() => null);
      const { litematicUrl, litematicName, renderUrl } = pickAttachments(starter);
      if (!litematicUrl) continue; // no schematic file -> not a usable entry
      out.push({
        threadId: thread.id,
        name: thread.name,
        tags: applied.map((id) => tagById.get(id)).filter(Boolean),
        litematicUrl,
        litematicName: litematicName || `${thread.name}.litematic`,
        renderUrl,
        // body needs the MessageContent privileged intent to be populated;
        // empty string is fine — the rest of the entry works without it.
        body: (starter && starter.content) || '',
        archived: !!thread.archived,
        createdAt: thread.createdTimestamp || 0,
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    schematics = out;
    updatedAt = Date.now();
    console.log(`[schematics] indexed ${schematics.length} tagged schematics, ${tagList.length} tags`);
  } finally {
    building = false;
  }
}

function startSchematicsJob(client) {
  _client = client;
  rebuild().catch((e) => console.error('[schematics] initial build failed', e));
  setInterval(() => rebuild().catch((e) => console.error('[schematics]', e)), config.schematicsRefreshMs);
}

module.exports = { startSchematicsJob, getSchematicIndex, rebuild };
