#!/usr/bin/env bash
# One-shot environment bootstrap for dunning.
#
# Safe to re-run — every step checks whether it's already done before acting.
# Covers everything this project has actually needed across real deployments:
# Node deps, PM2, Chromium's shared libraries, and (on Linux ARM64, where
# Puppeteer's bundled Chrome has no build at all) a system Chromium via snap.
#
# What this does NOT do: scan the WhatsApp QR code (needs an interactive
# `node index.js` run — see README) or start the process under PM2 (see
# README's Deployment section for that, once this finishes cleanly).

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

log() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

log "Checking Node.js"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found. Install Node 18+ first (e.g. via nvm: https://github.com/nvm-sh/nvm), then re-run this script."
  exit 1
fi
NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node $(node -v) found, but this project needs >=18. Upgrade Node and re-run."
  exit 1
fi
echo "Node $(node -v) OK"

log "Installing npm dependencies"
npm install

log "Checking PM2"
if command -v pm2 >/dev/null 2>&1; then
  echo "PM2 already installed ($(pm2 --version))"
elif npm install -g pm2 2>/dev/null; then
  echo "PM2 installed."
elif sudo -n true 2>/dev/null; then
  # Passwordless sudo available (won't hang waiting for a password) — use it.
  echo "Plain install failed (likely a permissions issue) — retrying with sudo..."
  sudo npm install -g pm2
else
  echo "Could not install PM2 automatically (no permission, and no passwordless sudo available here)."
  echo "You don't need it yet — it's only required for the background-deployment step. Install it yourself later with:"
  echo "  sudo npm install -g pm2"
fi

if [ "$(uname -s)" = "Linux" ]; then
  if command -v apt-get >/dev/null 2>&1; then
    log "Installing Chromium's runtime shared libraries (apt)"
    sudo apt-get update -y
    sudo apt-get install -y \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
      libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2 \
      libpangocairo-1.0-0 fonts-liberation libxss1 libappindicator3-1 \
      || echo "Some packages may already be current or named differently on your distro — check any errors above."
  else
    echo "No apt-get found — skipping shared-library install. If startup later fails with a missing .so error, install the equivalent packages for your distro (see README)."
  fi

  ARCH=$(uname -m)
  if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    log "Linux ARM64 detected — Puppeteer's bundled Chrome has no build for this architecture"
    CHROMIUM_PATH=""
    for candidate in /snap/bin/chromium /usr/bin/chromium /usr/bin/chromium-browser; do
      if [ -x "$candidate" ]; then
        CHROMIUM_PATH="$candidate"
        break
      fi
    done

    if [ -n "$CHROMIUM_PATH" ]; then
      echo "System Chromium already present at $CHROMIUM_PATH — the app auto-detects this, no config needed."
    else
      echo "Installing Chromium via snap (this can take a few minutes)..."
      if ! command -v snap >/dev/null 2>&1; then
        sudo apt-get install -y snapd
      fi
      sudo snap install chromium
      echo "Installed at /snap/bin/chromium — the app auto-detects this, no config needed."
    fi
  fi
fi

log "Scaffolding local config"
if [ ! -f config/local.json ]; then
  echo '{}' > config/local.json
  echo "Created config/local.json (empty) — add \"alertPhone\": \"<your number>\" here if you want WhatsApp alerts on send failures."
else
  echo "config/local.json already exists — left as-is."
fi

REAL_PROFILES=$(find profiles -maxdepth 1 -name '*.json' ! -name '_example.json' 2>/dev/null | wc -l | tr -d ' ')
if [ "$REAL_PROFILES" = "0" ]; then
  echo "No real profiles yet. Create one with:"
  echo "  cp profiles/_example.json profiles/<name>.json"
  echo "  then edit its phone/loanAmount/loanDateISO"
else
  echo "Found $REAL_PROFILES existing profile(s) in profiles/ — left as-is."
fi

log "Setup complete"
cat <<'EOF'
Next steps:
  1. If you haven't already, create/edit a profile (see above).
  2. Scan the WhatsApp QR, interactively, once:
       node index.js
     Wait for "... ready: ..." and the "Control panel: ..." line, then Ctrl+C.
  3. Run it permanently in the background:
       pm2 start ecosystem.config.js
       pm2 save
       pm2 startup   # then run the sudo command it prints
EOF
