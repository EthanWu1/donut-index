# Donut Index

A Discord bot for DonutSMP — player stats, leaderboards, auction house, and
Discord↔IGN account linking.

## Commands
- `/stats [username] [user]` — player statistics with 24h deltas and a balance-history chart
- `/link <username>` — link your Discord account to a DonutSMP IGN
- `/unlink` — remove your link
- `/leaderboard <type> [page]` — DonutSMP leaderboards
- `/ah [search] [page] [sort]` — browse the auction house
- `/worth <item> [amount]` — item value lookup (requires `data/prices.json`)

## Setup (local)
1. `npm install`
2. Copy `.env.example` to `.env` and fill in `BOT_TOKEN`, `CLIENT_ID`, and
   `DONUTSMP_API_KEYS` (comma-separated for a larger rate-limit budget).
   Leave `GUILD_ID` blank for global (multi-server) commands; set it to a test
   server id for instant command updates during development.
3. `npm run deploy` — register slash commands.
4. `npm start` — run the bot (or `pm2 start ecosystem.config.js`).

## Deploy on a Hetzner server (Ubuntu)

Tested on Hetzner Cloud, Ubuntu 22.04/24.04, x64 or arm64. `better-sqlite3` and
`@napi-rs/canvas` ship prebuilt binaries for both, so no compiler is needed.

```bash
# 1. SSH in, install Node 22 LTS + git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
sudo npm install -g pm2

# 2. Get the code (push this repo to GitHub first, then clone it)
git clone <your-repo-url> donutbot
cd donutbot/donutdex

# 3. Install production dependencies
npm ci --omit=dev
#    If a build is ever needed: sudo apt-get install -y build-essential python3

# 4. Create the .env file (chmod 600 so only you can read it)
cp .env.example .env
nano .env          # fill BOT_TOKEN, CLIENT_ID, DONUTSMP_API_KEYS; leave GUILD_ID blank
chmod 600 .env

# 5. Register slash commands (run once, and again whenever commands change)
npm run deploy

# 6. Start under PM2 and make it survive reboots
pm2 start ecosystem.config.js
pm2 save
pm2 startup        # run the command it prints
```

Operate it with `pm2 logs donut-index`, `pm2 restart donut-index`,
`pm2 status`. The SQLite database lives in `donutdex/data/donut.sqlite` — keep
that directory on persistent disk; it holds account links and stat history.

To update later: `git pull`, `npm ci --omit=dev`, `npm run deploy` (only if
commands changed), `pm2 restart donut-index`.

## Notes
- DonutSMP API: 250 requests/min per key; the bot pools multiple keys and caches
  responses. Get a key with `/api` in-game.
- 24h deltas and the history chart are computed from snapshots stored in
  `data/donut.sqlite`; history accumulates after the bot has run for a while.
