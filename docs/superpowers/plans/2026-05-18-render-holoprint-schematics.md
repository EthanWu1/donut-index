# Plan — /render, /holoprint, schematic index

Date: 2026-05-18
Repos: `donutdex` (Donut Index bot), `donutbot` (existing bot). Both on the
Hetzner host `verba` (`/home/ethan/`), managed by pm2.

## Scope (confirmed with owner)

1. **/render** ported to Donut Index, backed by a **shared render service** —
   one headless-Chromium process both bots call over loopback HTTP. No second
   Chromium.
2. **/holoprint** — its own command: attach a litematic, get back the
   HoloPrint pack file.
3. **Schematic index** — full 2-bot design: donutbot manages, Donut Index
   browses, shared `~/schematics/` folder.

---

## Feature 1 — Shared render service

### Why
donutbot's `/render` currently launches its own headless Chromium in-process
(`lib/litematicRender/renderer.js` — puppeteer + `@sparticuz/chromium` + a
loopback asset server). Donut Index needs the same capability. Running two
Chromiums wastes ~300MB RAM and double-maintains the stack. Extract the
renderer into one service.

### Architecture
- New pm2 process **`render-service`**, lives inside the **donutbot** repo
  (donutbot already has the renderer lib + puppeteer + chromium installed and
  proven on the host). Add `render-service/server.js`.
- Binds **127.0.0.1 only** (both bots are on the same host) → no auth needed.
  Port from env `RENDER_SERVICE_PORT` (default 4123).
- Wraps the existing `lib/litematicRender/renderer.js` — keeps the warm
  browser, in-flight queue, asset server, timeout/reset logic unchanged.

### Endpoints
- `POST /render` — body: raw litematic bytes; opts via query
  (`width,height,transparent,yaw`). Returns JSON `{ png: <base64>, meta }`.
- `POST /holoprint` — raw litematic bytes → `{ pack: <base64>, name }`
  (added in Feature 2).
- `GET /health` — readiness probe; reports whether the browser is initialised.

### Shared client
Tiny module `renderClient.js` (copied into **both** repos' `lib/`):
`renderLitematic(buffer, opts)` POSTs to the service, returns `{ png, meta }`
— **same signature** as the current local function, so callers swap the
dependency with no logic change.

### donutbot migration
- `lib/litematicRenderCommand.js` already takes `renderLitematic` as an
  injected dep (`deps.renderLitematic`). Change donutbot's wiring (`index.js`)
  to inject `renderClient.renderLitematic` instead of the local renderer.
- donutbot stops launching Chromium itself; the renderer code becomes the
  service's engine only.
- `ecosystem.config.js` (donutbot) gains the `render-service` app.
- **Acceptance:** donutbot `/render` + rotation arrows still work end-to-end.

### Donut Index /render
- New `commands/render.js` — port of `litematicRenderCommand.js`, adapted to
  donutdex conventions:
  - `renderLitematic` dep = donutdex's copy of `renderClient`.
  - Rotation button customId → `render:rot:<token>:<dir>` so donutdex's
    existing `interactionCreate.js` prefix router dispatches it to
    `commands/render.js`'s exported `button()`.
- Register `/render` (one `litematic` attachment option) via `deploy-commands`.
- Keep cooldown / in-flight queue / 5MB cap / session TTL from the original.

---

## Feature 2 — /holoprint

### Spike finding (M3)
HoloPrint (`makePack()` in `src/HoloPrint.js`) works and returns a
`<name>.holoprint.mcpack` File — but it **only reads `.mcstructure`** (Bedrock
structure-block exports) and hard-rejects everything else. The schematic
forum is all **`.litematic`** (Java / Litematica). So `/holoprint` needs two
stages, not one:

```
.litematic --[Feature 2a: bridge]--> .mcstructure --[Feature 2b: HoloPrint]--> .holoprint.mcpack
```

### Feature 2a — litematic → mcstructure bridge (the hard part, M6)
No npm package does Java→Bedrock block translation. Build
`render-service/litematicToMcstructure.js`:
- Reuse donutbot's `lib/litematicRender/litematicReader.js` `readLitematic()`
  → `{ blocks:[{x,y,z,name,properties}], size }` (Java names + states).
- `mapJavaToBedrock(name, props)` — namespace kept; **best-effort** state
  translation for the divergent block families (stairs `facing/half/shape` →
  `weirdo_direction/upside_down_bit`, logs `axis` → `pillar_axis`, slabs,
  doors, trapdoors, buttons, fences/walls/gates, redstone, etc.). Common
  blocks translate exactly; exotic/technical blocks map approximately.
- Assemble mcstructure NBT (`format_version`, `size`, `structure.block_indices`
  two layers, `structure.palette.default.block_palette`,
  `structure_world_origin`); serialise little-endian via `prismarine-nbt`.
- **Untestable without a Minecraft client** — correctness is verified in-game
  by the owner. Accepted quality bar: best-effort (common blocks correct).

### Feature 2b — headless HoloPrint (M3)
Reuse the render service's Chromium. Vendor HoloPrint into
`render-service/holoprint/`, served by the loopback asset server. A
`holoprint-entry.html` imports `HoloPrint.js` + `ResourcePackStack.js` and
exposes `window.__makeHoloPrint(mcstructureBytes, config)`. `makePack()`
fetches Bedrock vanilla resources via `ResourcePackStack` — the headless page
needs outbound network (or a vendored resource cache). `POST /holoprint`:
litematic bytes → bridge → mcstructure → `page.evaluate` → pack base64.

### Command
`commands/holoprint.js` on Donut Index: attach `.litematic` → `POST /holoprint`
→ reply with the `.holoprint.mcpack` attachment. Also wired as a button on
the `/schematics` detail view (M5).

### Output extension
Confirmed: HoloPrint emits `<name>.holoprint.mcpack` natively — exactly what
the owner asked for.

---

## Feature 3 — Schematic index (reads donutbot's forum)

### Discovery
donutbot already has a complete schematic publishing pipeline: "Publish
Schematic" tickets → draft preview → `/publish` →
`publishOrUpdateSchematicForumPost()` creates a thread in the **schematic
forum channel** (`SCHEMATIC_FORUM_CHANNEL_ID = 1504844039546208386`). Each
thread's starter message carries the body text, a `render.png`, and the
`<name>.litematic` attachment; a gallery message holds extra images.

### Design (per owner: tag-gated, read-only on Donut Index)
A schematic appears in Donut Index **only when it has been posted to that
forum AND tagged** with the forum's Discord tags. So Donut Index needs **no
new management command and no shared folder** — it reads donutbot's forum
directly and uses the forum tags as categories.

- **donutbot — no code changes.** Staff publish via the existing flow, then
  apply forum tags to the thread. The applied tag is the gate.

- **Donut Index:**
  - `jobs/schematics.js` — periodic scan (mirrors the auction/leaderboard
    jobs):
    - Fetch active + archived threads of the schematic forum.
    - Read each thread's `appliedTags`; **skip threads with zero tags.**
    - Fetch the starter message → `.litematic` URL, `render.png` URL, body,
      size/volume.
    - Map tag ids → names via the forum's `availableTags`.
    - Build an in-memory index; refresh on a timer.
  - `commands/schematics.js` — `/schematics` browse panel over the index:
    - Tag filter select menu (options = the forum's `availableTags`).
    - Pagination; name search via an autocompleted command option.
    - Detail view: render thumbnail, body/metadata, buttons —
      **Download** (`.litematic`), **Render** (render service),
      **HoloPrint** (`.mcpack` via service).
  - Config: `SCHEMATIC_FORUM_CHANNEL_ID` + donutbot guild id. Donut Index
    must be invited to that guild with View Channel + Read Message History
    on the forum.

This removes the shared `~/schematics/` folder, the `index.json` manifest,
and the new `/schematic` commands from the earlier design — Donut Index's
side is pure-read.

---

## Build order

| Milestone | Deliverable | Status |
|-----------|-------------|--------|
| **M1** | Render service + donutbot migrated to it | ✅ done |
| **M2** | Donut Index `/render` + rotation buttons | ✅ done |
| **M4** | `jobs/schematics.js` + `/schematics` (forum-read) | ✅ done |
| **M5a** | `/schematics` Render button | ✅ done |
| **M6** | litematic → mcstructure bridge (Feature 2a) | ⛔ to build — biggest single piece |
| **M3** | headless HoloPrint endpoint + `/holoprint` command (Feature 2b) | ⛔ blocked on M6 |
| **M5b** | `/schematics` HoloPrint button | ⛔ blocked on M3 |

Resolved: HoloPrint output = `.holoprint.mcpack` (native). Schematic
categories = the schematic forum's Discord tags.

## Risks / open questions
- **HoloPrint headless feasibility** — M3 spike-gated; fallback = link the web app.
- **Render service = single point of failure** — pm2 autostart + `/health`
  check + a clean "renderer offline" error in both bots.
- **Two-repo deploy coordination** — M1 ships donutbot + the service together;
  donutbot must not be left calling a service that isn't up yet.
- **Donut Index guild access** — Donut Index must be invited to the donutbot
  guild with read access to the schematic forum, or `/schematics` has no source.
- **Archived-thread scan cost** — fetching all archived forum threads each
  refresh is API-heavy; the job should page archived threads and cache by
  thread id + last-edit timestamp to avoid re-fetching unchanged posts.
