const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const logger = require('./logger');

let isReady = false;

function createClient() {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
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

async function sendToProfile(client, profile, text) {
  if (!isReady) throw new Error('client not ready');
  await client.sendMessage(toChatId(profile.phone), text);
}

async function sendSelf(client, text) {
  if (!isReady) throw new Error('client not ready');
  await client.sendMessage(selfChatId(client), text);
}

module.exports = { createClient, toChatId, selfChatId, getIsReady, sendToProfile, sendSelf };
