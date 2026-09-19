const whatsapp = require('./whatsapp');
const profiles = require('./profiles');
const logger = require('./logger');

let clientRef = null;

function init(client) {
  clientRef = client;
}

async function sendAlert(text) {
  const globalConfig = profiles.loadGlobalConfig();
  const alertPhone = globalConfig.alertPhone;
  if (!alertPhone) return;

  logger.logEvent('alert', { text });

  if (!clientRef || !whatsapp.getIsReady()) return;

  try {
    await clientRef.sendMessage(whatsapp.toChatId(alertPhone), `[debt-reminder alert]\n${text}`);
  } catch (err) {
    logger.logEvent('alert_send_failed', { error: err.message });
  }
}

module.exports = { init, sendAlert };
