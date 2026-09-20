# dunning

A small self-hosted service that sends a daily WhatsApp reminder message to one or more people, calculating "days since loan" and "amount that should have been saved per day" fresh on every send.

Built with [`whatsapp-web.js`](https://wwebjs.dev/) (unofficial WhatsApp Web automation), `node-cron`, and PM2. Runs as a single Node.js process — no database, no Docker, no external server required.

> **Disclaimer:** `whatsapp-web.js` automates the WhatsApp Web client and is not an official WhatsApp API. Using it carries some risk of account restriction. This project is built to behave minimally — one message per profile per day, no bulk sending, no spam.

## Features

- **Multi-profile**: each person you're nagging is a JSON file — add, remove, or tweak them independently.
- **Self-chat commands**: control it from WhatsApp itself, by messaging your own "Message Yourself" chat.
- **Local control panel**: a token-protected web dashboard showing live status, per-profile pause/resume, a manual "send now" test button, and a live event feed.
- **WhatsApp alerts**: if a send fails, you get a WhatsApp message about it.
- **Self-healing startup**: `whatsapp-web.js` occasionally throws a flaky startup error against current Chrome builds — the process retries automatically instead of silently dying. Sends themselves get a short automatic retry too, for a separate transient race in the same library.
- **Runs anywhere**: one setup script (`npm run setup`) handles Mac, plain x86_64 Linux, and Linux ARM64 (Raspberry Pi, AWS Graviton, Oracle Ampere) alike — including auto-detecting a system Chromium on ARM, where Puppeteer's bundled one doesn't exist.

## Setup

```bash
npm run setup
```

This bootstraps everything the project actually needs, and is safe to re-run: installs npm dependencies, installs PM2 if it's missing, installs Chromium's runtime shared libraries (Ubuntu/Debian), and — only on Linux ARM64, where Puppeteer's bundled Chrome has no build at all — installs a system Chromium via snap. It also scaffolds `config/local.json` and tells you if you still need to create a profile. Works the same on a Mac for local dev, a plain x86_64 Ubuntu server, or an ARM64 cloud box (Graviton, Ampere, Raspberry Pi).

If you'd rather do it by hand, or `npm run setup` doesn't fit your OS, see [Manual setup](#manual-setup) below — every step it automates is documented there individually.

Once setup finishes, scan the WhatsApp QR (once):

```bash
node index.js
```

Open WhatsApp on your phone → **Linked Devices** → **Link a Device** → scan the QR that prints in the terminal. Once you see `dunning ready: ...` in the console, the session is authenticated and persisted to `.wwebjs_auth/` — you won't need to scan again unless that folder is deleted or the linked device is removed from your phone.

Press `Ctrl+C` once you see the ready message and the `Control panel: http://...` line, then move on to [Deployment](#deployment) to run it permanently in the background.

## Profiles

Each person you want reminders sent to is a "profile" — a JSON file in `profiles/`. **Real profiles are gitignored** (`profiles/*.json`, except the template below) because they contain phone numbers and loan amounts. Only `profiles/_example.json` is tracked, as a placeholder to copy from.

To create your first real profile:

```bash
cp profiles/_example.json profiles/<yourname>.json
```

Then edit it, or create one directly via the `/add` chat command or the control panel.

Profile fields:

| Field | Meaning |
|---|---|
| `id` | Slug, must match the filename (`profiles/<id>.json`) |
| `displayName` | Human-readable name, for your own reference |
| `phone` | Digits only, country code included, no `+` (e.g. `<COUNTRYCODE><NUMBER>`) |
| `loanAmount` | Total amount owed |
| `loanDateISO` | Loan start date, `YYYY-MM-DD` |
| `cronSchedule` | Cron string, or `null` to use the global default (`config/default.json`) |
| `timezone` | IANA timezone, or `null` to use the global default |
| `messageTemplate` | Message text with `{days}`/`{amount}` placeholders, or `null` to use the global default template (`config/message.template.txt`) |
| `paused` | If `true`, the daily job is skipped (and logged as `skipped-paused`) |

### Editing profiles by hand

Edit the JSON file directly (change amounts, pause it, etc.), then either restart the process (`pm2 restart dunning`) or send `/reload` in your own WhatsApp chat to pick up the change without a restart.

### The message template

The default message lives in `config/message.template.txt` — a plain text file, not JSON, so you can edit multi-line text (with `{days}`/`{amount}` placeholders) without worrying about escaping newlines. It ships with the original Malayalam template; edit it directly to change the wording for everyone, or set a profile's own `messageTemplate` field to override it for just that person. After editing, send `/reload` (or restart) to pick up the change.

## Controlling it

There are two ways to control the bot day-to-day. Both work concurrently.

### 1. The control panel (recommended)

When the bot is ready, it prints a URL like:

```
Control panel: http://127.0.0.1:4173/?token=<random-token>
```

Open that URL in a browser on the same machine (or over an SSH tunnel — see below for a remote server). It shows:

- Whether WhatsApp is currently connected
- Every profile, with **Pause**/**Resume** and **Send now (test)** buttons (the test button sends a real message immediately, useful for verifying things work without waiting for the schedule)
- A live feed of everything that's happened today (sends, errors, lifecycle events, commands)

The page auto-refreshes every 5 seconds. It's protected by a random token (stored in `.dashboard_token`, gitignored) baked into the URL — don't share that link.

By default it only binds to `127.0.0.1` (not reachable from outside the machine). To view it from your own laptop when the bot runs on a remote server, forward the port over SSH instead of opening it to the internet:

```bash
ssh -L 4173:127.0.0.1:4173 user@your-server
```

Then open `http://127.0.0.1:4173/?token=...` locally. The port/host are configurable in `config/default.json` under `controlPanel` if you need something different.

### 2. WhatsApp self-chat commands

Since the bot is logged in as your own WhatsApp account, you can also control it by messaging **yourself** — open the "Message Yourself" chat (search your own name/number in WhatsApp) and send commands there. Only messages in that self-chat are ever treated as commands; messages from/to any other chat (including a debtor's own number) are ignored.

| Command | Effect |
|---|---|
| `/help` | List commands |
| `/list` | Show all profiles with paused/active state and today's computed day/amount |
| `/status <id>` | Full detail for one profile |
| `/pause <id>` / `/resume <id>` | Stop/restart sending for one profile |
| `/setamount <id> <amount>` | Change the loan amount |
| `/setdate <id> <YYYY-MM-DD>` | Change the loan start date |
| `/add <id> <phone> <amount> <YYYY-MM-DD>` | Create a new profile (inherits the global schedule/template) |
| `/remove <id> confirm` | Delete a profile (the `confirm` token is required to avoid accidental deletes) |
| `/reload` | Re-read all profiles and `config/default.json` from disk |
| `/send <id>` | Send that profile's message right now, outside the schedule |

Message templates aren't editable via chat — multi-line Malayalam text with `{placeholders}` is fiddly to type correctly in a single WhatsApp message. Edit the template in the profile's JSON (or `config/default.json` for the shared default) and send `/reload`.

If self-chat commands ever seem to stop working, every incoming message is logged as a `message_seen` event (visible in the dashboard's event feed or `logs/*.log`) whether or not it matched — that log line shows exactly what WhatsApp delivered, plus `matchedSelfChat`/`matchedAdminPhone` flags and the account identities the bot knows itself by. That's the place to look first.

### 3. Commands from a second phone (optional)

Self-chat depends on WhatsApp's own account addressing, which it has been changing (see the `@lid` note in [Troubleshooting](#troubleshooting)). If you'd rather not depend on that, set `adminPhone` in `config/local.json` to a second number you own:

```json
{
  "adminPhone": "<COUNTRYCODE><NUMBER>"
}
```

Messages from that number are then accepted as commands (same command set), with replies sent back to it. Because it's an ordinary incoming message rather than a self-message, it works regardless of how WhatsApp addresses your own account. Only that exact number is accepted; anyone else messaging the bot is ignored, as always. Leave it `null` to disable this channel entirely.

## Alerts

If a scheduled send fails (`status: "error"`), the bot sends you a WhatsApp message about it (to `alertPhone` in `config/default.json`). Connection-level problems (disconnected, auth failure) can't be alerted over WhatsApp itself, for the obvious reason — those show up in the dashboard's event feed and in the logs instead.

## Global config

`config/default.json` (tracked, no personal data):

```json
{
  "timezone": "Asia/Kolkata",
  "defaultCronSchedule": "0 9 * * *",
  "alertPhone": null,
  "controlPanel": { "port": 4173, "host": "127.0.0.1" }
}
```

- `timezone` / `defaultCronSchedule` — fallback values used by any profile that leaves those fields `null`. The fallback message template lives separately in `config/message.template.txt`.
- `alertPhone` — where send-failure alerts go. Left `null` here since it's personal; set the real number in `config/local.json` instead (see below).
- `adminPhone` — optional second number allowed to send commands (see [Commands from a second phone](#3-commands-from-a-second-phone-optional)). Also personal, so it belongs in `config/local.json`.
- `controlPanel` — host/port the dashboard listens on.

### Personal overrides: `config/local.json`

`config/local.json` is **gitignored**. If it exists, its keys are merged on top of `config/default.json` at load time — this is where your real `alertPhone` (or any other override) goes, so it never ends up committed:

```json
{
  "alertPhone": "<COUNTRYCODE><NUMBER>"
}
```

This file is optional; without it, alerts are simply skipped (no crash).

## Deployment: headless server, running permanently in the background

No `screen`, no `tmux`, no terminal left open — PM2 daemonizes the process and keeps it running across reboots.

1. **Install Node.js (>=18)** on the server (e.g. via [nvm](https://github.com/nvm-sh/nvm)).
2. **Copy the project over** (git clone, `scp -r`, or `rsync`).
3. **Run the bootstrap script**:
   ```bash
   npm run setup
   ```
   This installs npm dependencies, PM2, Chromium's shared libraries, and (on ARM64 only) a system Chromium — see [Manual setup](#manual-setup) below if you'd rather do these individually or hit something the script doesn't cover for your distro.
4. **First run must be interactive**, once, so you can scan the QR (PM2's log capture doesn't render QR codes reliably):
   ```bash
   node index.js
   ```
   Scan it, wait for the `dunning ready: ...` line, then `Ctrl+C`. This writes the session to `.wwebjs_auth/` — every run after this is unattended.
5. **Start it under PM2** (this is what replaces `screen`/`tmux` — the process keeps running after you log out):
   ```bash
   pm2 start ecosystem.config.js
   ```
6. **Make it survive reboots**:
   ```bash
   pm2 save
   pm2 startup
   ```
   Run the `sudo env PATH=...` command that `pm2 startup` prints out — that's what registers PM2 as a systemd service so it comes back up automatically after the server restarts.
7. **(Optional) Cap PM2's own log growth**:
   ```bash
   pm2 install pm2-logrotate
   ```

Useful PM2 commands afterwards:

```bash
pm2 status              # is it running?
pm2 logs dunning  # tail stdout/stderr
pm2 restart dunning
pm2 stop dunning
```

To check on it visually instead of the terminal, use the control panel over an SSH tunnel (see [Controlling it](#controlling-it) above).

## Manual setup

What `npm run setup` (`scripts/setup.sh`) does, step by step — useful if you're on a distro it doesn't handle, or just want to see exactly what's happening:

1. **Install dependencies**: `npm install`.
2. **Install PM2 globally**, if not already present: `npm install -g pm2` (falls back to `sudo` if that fails on permissions).
3. **Install Chromium's runtime shared libraries** (Debian/Ubuntu only — Puppeteer needs these even headless):
   ```bash
   sudo apt-get update
   sudo apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
     libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2 \
     libpangocairo-1.0-0 fonts-liberation libxss1 libappindicator3-1
   ```
   Package names shift slightly between Ubuntu versions (e.g. `libasound2` vs `libasound2t64` on 24.04) — if a specific one fails, search the current name for your release and install that instead.
4. **On Linux ARM64 only**: install a system Chromium. Google's Chrome for Testing (what Puppeteer downloads by default) has no Linux ARM64 build at all — the download silently produces a broken install (folder exists, executable doesn't), no matter how many times you retry it. The `chromium` apt package is also unreliable across Ubuntu mirrors (it's often just missing, as opposed to a real package). Snap is what actually works:
   ```bash
   sudo apt-get install -y snapd   # if snap isn't already installed
   sudo snap install chromium
   ```
   That lands at `/snap/bin/chromium`. **You don't need to configure anything else** — `src/whatsapp.js` auto-detects a system Chromium at the standard paths (`/snap/bin/chromium`, `/usr/bin/chromium`, `/usr/bin/chromium-browser`) whenever it's running on Linux ARM64 and no `PUPPETEER_EXECUTABLE_PATH` is set. Only set that env var yourself if your Chromium lives somewhere nonstandard.
5. **Scaffold local config**: create an empty `config/local.json` (for `alertPhone`, gitignored) if one doesn't exist, and check whether a real profile exists in `profiles/` yet.

None of this scans the QR or starts PM2 — those stay manual/interactive steps regardless (see [Deployment](#deployment) above).

## Logs

`logs/YYYY-MM-DD.log` — one JSON object per line, covering daily send attempts (`sent`, `error`, `skipped-paused`, `skipped-future-date`, `skipped-not-ready`), client lifecycle events, every message the bot has seen (for debugging self-chat detection), and an audit trail of admin commands. Plain text, not rotated automatically; delete old ones periodically if desired:

```bash
find logs -mtime +90 -delete
```

## Troubleshooting

- **QR expired before scanning:** `Ctrl+C` and re-run `node index.js` for a fresh QR.
- **Session invalidated** (phone unlinked the device, or WhatsApp logged it out remotely): delete `.wwebjs_auth/` and repeat the interactive first-run login.
- **Startup fails with `Could not load response body for this request`:** this is a known flaky issue in `whatsapp-web.js` against current Chrome/Puppeteer builds — it's unrelated to your setup. The process automatically retries a fresh browser up to 5 times with backoff before giving up; under PM2 it'll keep retrying across restarts. If you ever try to "fix" this by pinning a specific WhatsApp Web version, be aware that can get your session logged out server-side — don't do that; just let the retry logic handle it.
- **Missing Chromium shared library on Ubuntu:** see step 3 of Deployment.
- **`Could not find Chrome` / a downloaded Chrome folder exists but the executable inside it doesn't (on an ARM64 server):** Google's Chrome for Testing (what Puppeteer downloads by default) has no Linux ARM64 build — this isn't fixable by re-running the install, it genuinely doesn't exist for this architecture, and it'll keep failing every startup attempt (the retry logic can't help here, this isn't transient). `npm run setup` handles this automatically via snap, but if you're doing it by hand: the `chromium` apt package is unreliable on Ubuntu ARM mirrors (often just missing, not a real package) — use snap instead:
  ```bash
  sudo snap install chromium
  ```
  You don't need to set `PUPPETEER_EXECUTABLE_PATH` — it's auto-detected at `/snap/bin/chromium` (or `/usr/bin/chromium[-browser]`) whenever running on Linux ARM64. Only set the env var explicitly if your Chromium lives somewhere else. On normal x86_64 servers none of this applies — Puppeteer's default download works fine there.
- **No QR code visible under PM2:** the first login must be done with `node index.js` run directly in a terminal, not under PM2.
- **`npm install` itself fails** with `...exists but the executable...is missing` (as opposed to failing later at runtime): this means Puppeteer's browser cache (`~/.cache/puppeteer/`) has a corrupted/partial download in it, usually from a previous install that got interrupted (Ctrl+C mid-download, network drop, disk full). Fix by clearing the specific broken version folder it names and re-running `npm install` (or `npm run setup`):
  ```bash
  rm -rf ~/.cache/puppeteer/chrome*/<version-it-names>
  npm install
  ```
- **Self-chat commands not triggering:** check the dashboard's event feed (or `logs/*.log`) for `message_seen` entries — they show exactly what WhatsApp delivered for every message, matched or not, plus `matchedSelfChat`/`matchedAdminPhone`. Two things to look for:
  - **No `message_seen` entry at all** for a command you just sent → WhatsApp isn't delivering that message to the client as an event, so no matching logic can help. Use the [admin phone channel](#3-commands-from-a-second-phone-optional) or the control panel instead.
  - **An entry with `matchedSelfChat: false`** → an id mismatch. WhatsApp is migrating accounts from the classic `<number>@c.us` addressing to an opaque `<id>@lid` ("linked id") form, and `client.info` only ever reports the `@c.us` one — so a self-chat keyed by `@lid` won't match a naive comparison. This is handled now (self-chat is detected by sender and recipient being the *same entity*, whichever format is used, and the account's `@lid` identity is learned from incoming messages), but the `knownSelfIds` field in that log entry is what to check if it ever regresses.

## Out of scope (for now)

No database, no Docker, no external dashboard framework, no Telegram integration — these remain possible future additions but aren't part of this build.
