const fs = require('fs');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const logger = require('./logger');

let isReady = false;

// Puppeteer's bundled "Chrome for Testing" has no Linux ARM64 build — on an
// ARM server (Raspberry Pi, AWS Graviton, Oracle Ampere, etc.) the download
// silently produces a broken install (folder exists, executable doesn't).
// A system Chromium is the standard fix there; these are the paths it's
// commonly installed at (snap is what `sudo snap install chromium` gives
// you, which is the norm on Ubuntu 22.04+). PUPPETEER_EXECUTABLE_PATH
// always wins if set, so this only kicks in as a same-architecture default.
const KNOWN_ARM_CHROMIUM_PATHS = ['/snap/bin/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser'];

function resolveExecutablePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  if (process.platform === 'linux' && process.arch === 'arm64') {
    return KNOWN_ARM_CHROMIUM_PATHS.find((candidate) => fs.existsSync(candidate));
  }
  return undefined;
}

function createClient() {
  const executablePath = resolveExecutablePath();
  if (process.platform === 'linux' && process.arch === 'arm64' && !executablePath) {
    console.warn(
      'Running on Linux ARM64 but no system Chromium was found at ' +
        `${KNOWN_ARM_CHROMIUM_PATHS.join(', ')}. Puppeteer's bundled Chrome ` +
        'does not support this architecture and startup will likely fail — ' +
        'run `sudo snap install chromium` (see README Troubleshooting) or set ' +
        'PUPPETEER_EXECUTABLE_PATH to a Chromium binary yourself.'
    );
  }

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath
    }
  });

  client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
  });

  client.on('authenticated', () => logger.logEvent('authenticated'));

  client.on('auth_failure', (msg) => logger.logEvent('auth_failure', { msg }));

  client.on('disconnected', (reason) => {
    isReady = false;
    logger.logEvent('disconnected', { reason });
  });

  client.on('ready', () => {
    isReady = true;
    logger.logEvent('ready');
  });

  return client;
}

function toChatId(phone) {
  return `${phone}@c.us`;
}

function selfChatId(client) {
  return client.info.wid._serialized;
}

function getIsReady() {
  return isReady;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// whatsapp-web.js injects a helper script (window.WWebJS) into the page that
// sendMessage depends on. It re-injects that script on every "app state
// synced" resync, but there's a brief gap while that's in progress where a
// send lands on a page that doesn't have it yet — surfacing as "Cannot read
// properties of undefined (reading 'getChat')". That failure happens before
// anything is actually sent, so retrying is always safe (never a duplicate
// message).
async function sendWithRetry(client, chatId, text, attempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await client.sendMessage(chatId, text);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) await sleep(1500);
    }
  }
  throw lastErr;
}

async function sendToProfile(client, profile, text) {
  if (!isReady) throw new Error('client not ready');
  await sendWithRetry(client, toChatId(profile.phone), text);
}

async function sendSelf(client, text) {
  if (!isReady) throw new Error('client not ready');
  await sendWithRetry(client, selfChatId(client), text);
}

module.exports = { createClient, toChatId, selfChatId, getIsReady, sendToProfile, sendSelf };
