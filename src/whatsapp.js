const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const logger = require('./logger');

let isReady = false;

function createClient() {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      // Puppeteer's own bundled "Chrome for Testing" has no Linux ARM64
      // build. On ARM servers, install a system Chromium (e.g.
      // `sudo apt-get install chromium`) and point this at it via
      // PUPPETEER_EXECUTABLE_PATH — left unset, Puppeteer's default
      // (downloaded) browser resolution is unaffected.
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
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
