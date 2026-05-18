# Donut Index — DonutSMP Stats Bot — Design

Status: APPROVED — name + credentials confirmed
Date: 2026-05-17

## Purpose

A standalone Discord bot that surfaces DonutSMP player data — stats, net worth,
leaderboards, and the auction house — inside Discord. Separate codebase from the
existing `etz-paybot`; shares conventions (discord.js v14, CommonJS, PM2) but its
own process, token, and storage.

## Naming

Bot name: **Donut Index** (`Donut Stats` was taken). Folder: `donutdex/`.

## Install model (multi-server)

The bot ships as a public, multi-server bot.

- Slash commands register **globally** in production (work on every server; ~1h
  propagation).
- `deploy-commands.js` supports both modes: `GUILD_ID` set → guild deploy (instant,
  dev only); `GUILD_ID` blank → global deploy (production).
- Discord Developer Portal: enable **Public Bot**, configure the **Installation**
  tab with scopes `bot` + `applications.commands`.

## Credentials (live in `.env`, never committed)

- `BOT_TOKEN` — **must be regenerated**; the first token was pasted in plain text.
- `CLIENT_ID` — `1467728249936417026`.
- `DONUTSMP_API_KEY` / `DONUTSMP_API_KEYS` — comma-separated for the key pool.
- `GUILD_ID` — optional, dev-only.

## DonutSMP API (researched)

- Base: `https://api.donutsmp.net/v1`
- Auth header: `Authorization: <API_KEY>` (the existing `donutsApi.js` uses the raw
  key; the community MCP uses `Bearer <key>`. We will try raw first, fall back to
  Bearer on 401.)
- Rate limit: **250 requests / minute / key**
- Responses wrap payload in `{ "result": ... }`.
- Endpoints used:
  - `GET /stats/{user}` — player stats (balance, shards, kills, deaths, playtime,
    placed/broken blocks, mobs killed, money spent/made). Drives `/stats`.
  - `GET /lookup/{user}` — player lookup / online status (last seen, online flag).
  - `GET /leaderboards/{type}/{page}` — types: brokenblocks, deaths, kills,
    mobskilled, money, placedblocks, playtime, sell, shards, shop.
  - `GET /auction/list/{page}` — current AH listings (paginated).
  - `GET /auction/transactions/{page}` — AH sale history (paginated).

Exact field names inside `result` are confirmed at build time against a live key
(`result.money` is already known to be balance).

## Rate-limit strategy (multiple keys)

Yes — multiple API keys are supported and recommended.

- Config holds an array of keys. A round-robin pool issues each request on the
  next key; effective budget = `250 * N` req/min.
- Per-key sliding-window counter; if a key is near its cap the pool skips it.
- Response caching layer on top:
  - `/stats` and `/lookup`: cache ~60s per user.
  - `/leaderboards`: cache ~5 min per type+page.
  - `/auction/*`: cache ~60s per page.
- A 429 marks that key cooling-down for the remainder of its window.

## Commands

### `/stats [user] [username]`
- `user` — a Discord member (resolves to their linked IGN).
- `username` — a raw Minecraft IGN.
- Neither given → uses the caller's own linked IGN.
- Output: an embed matching the supplied screenshot — Balance, Shards, Kills,
  Deaths, Playtime, Blocks Placed, Blocks Broken, Mobs Killed, Money Spent (Shop),
  Money Made (Sell), Last Seen, online/offline footer, player head thumbnail.
- 24h deltas (`1.76M (-2.96B / 24h)`) come from our own stored snapshots, not the
  API — see Stat History below.
- Buttons: **View Stats History** (balance graph, 24h/7d/30d/All ranges),
  **View Auction Sells** (this player's rows from `/auction/transactions`).
- Cleanup vs. screenshot: consistent number formatting, aligned fields, color-coded
  deltas (green up / red down), neutral embed color tinted to brand.

### `/link <username>`
- Maps caller's Discord ID ↔ IGN in the DB.
- Validates the IGN exists via `/lookup`.
- Optional later: ownership verification (code in Minecraft name/AH). v1 = trust.

### `/unlink`
- Removes the caller's mapping.

### `/leaderboard <type> [page]`
- `type` — one of the 10 leaderboard types (autocomplete).
- Paginated embed with Prev/Next buttons; highlights the caller's linked IGN if
  present on the page.

### `/ah [search] [page] [sort]`
- Browses `/auction/list`. `search` filters by item name, `sort` by price/newest.
- Filtering/sorting is client-side over fetched pages (API only paginates).
- Paginated embed with Prev/Next.

### `/worth <item> [amount]`
- Looks up an item's value from a user-supplied price list (provided later).
- `amount` multiplies the unit price.
- Net-worth-by-player is **out of scope for v1**: the API exposes no inventory, so
  a true net worth can't be computed. Revisit if an inventory endpoint appears.

## Stat history (for 24h deltas + the graph)

- SQLite (`better-sqlite3`) table `stat_snapshots(ign, ts, money, shards, kills, …)`.
- A player becomes "tracked" the first time anyone runs `/stats` on them.
- A background job snapshots all tracked players every ~3h (budget-aware, batched).
- 24h delta = current value − newest snapshot ≥24h old (or oldest available).
- `View Stats History` renders a balance line chart (`@napi-rs/canvas`, already a
  dependency in the sibling bot) over 24h/7d/30d/All.

## Architecture / files

```
donutdex/
  index.js              client bootstrap, command/event loader
  deploy-commands.js     registers slash commands
  config.js              env + constants (cache TTLs, snapshot interval)
  .env.example
  ecosystem.config.js    PM2
  lib/
    api.js               key-pool + cache + DonutSMP request helpers
    db.js                better-sqlite3: links + snapshots
    format.js            number formatting (1.76M, 4.79B), playtime, deltas
    embeds.js            shared embed builders
    chart.js             balance-history chart renderer
    emojis.js            emoji id map (filled from user's emojis)
  commands/
    stats.js  link.js  unlink.js  leaderboard.js  ah.js  worth.js
  events/
    ready.js  interactionCreate.js
  jobs/
    snapshot.js          periodic stat snapshot job
  data/                  sqlite file (gitignored)
```

Stack: discord.js v14, CommonJS, dotenv, better-sqlite3, @napi-rs/canvas. Matches
the sibling bot so conventions and deploy flow carry over.

## Emoji assets

Custom emojis already uploaded; IDs captured below. `lib/emojis.js` holds the map
as `<:name:id>` strings. Stat-field assignments are provisional pending the full
list (the emoji panel scrolls — more may exist below).

| Emoji        | ID                  | Provisional use            |
|--------------|---------------------|----------------------------|
| emerald      | 1505694549765390337 | Balance                    |
| amethyst     | 1505694549178060922 | Shards                     |
| sword        | 1505694548481806356 | Kills                      |
| clock        | 1505694547785552004 | Playtime                   |
| zombie       | 1505694546569199706 | Mobs Killed                |
| skeleton     | 1505694544811917442 | Deaths                     |
| cobblestone  | 1505694543587184710 | Blocks Broken              |
| stone        | 1505694542664302682 | Blocks Placed              |
| iron         | 1505694541796212827 | spare / `/ah` / `/worth`   |
| gold         | 1505694540898635787 | Money Made (Sell)          |
| redstone     | 1505694540093194291 | spare                      |
| shulker      | 1505694539472703701 | spare / `/ah`              |
| chest        | 1505694538143109200 | Money Spent (Shop)         |

## What the user must provide

1. **DonutSMP API key(s)** — `/api` in-game. One supplied; more = bigger budget.
2. **Regenerated `BOT_TOKEN`** — into `.env` only.
3. **Item price list** — for `/worth` (later; `/worth` ships stubbed until then).
4. **Remaining emoji IDs** — if the emoji panel has entries below the captured 13.

## Open items (assumptions, not blockers)

- Exact `/stats` result field names verified against a live key at build time.
- `/worth` semantics assumed = item price lookup; confirm if a player net-worth
  variant is wanted instead.
- Link verification deferred to v2.
