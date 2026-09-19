const cron = require('node-cron');
const profiles = require('./profiles');
const messaging = require('./messaging');
const whatsapp = require('./whatsapp');
const logger = require('./logger');
const alerts = require('./alerts');

const taskMap = new Map();
let clientRef = null;

async function runProfileJob(profileId) {
  const profile = profiles.getById(profileId);
  if (!profile) return { status: 'no-such-profile' };

  if (profile.paused) {
    logger.logSend({ profileId, days: null, amount: null, status: 'skipped-paused' });
    return { status: 'skipped-paused' };
  }

  if (!whatsapp.getIsReady()) {
    logger.logSend({ profileId, days: null, amount: null, status: 'skipped-not-ready' });
    return { status: 'skipped-not-ready' };
  }

  const globalConfig = profiles.loadGlobalConfig();
  const { messageTemplate } = profiles.resolveEffective(profile, globalConfig);
  const result = messaging.buildMessage(profile, messageTemplate);

  if (result.skip) {
    logger.logSend({ profileId, days: result.days, amount: null, status: 'skipped-future-date' });
    return { status: 'skipped-future-date', days: result.days };
  }

  try {
    await whatsapp.sendToProfile(clientRef, profile, result.text);
    logger.logSend({ profileId, days: result.days, amount: result.amount, status: 'sent' });
    return { status: 'sent', days: result.days, amount: result.amount, text: result.text };
  } catch (err) {
    logger.logSend({
      profileId,
      days: result.days,
      amount: result.amount,
      status: 'error',
      error: err.message
    });
    alerts.sendAlert(`Failed to send to ${profileId}: ${err.message}`);
    return { status: 'error', error: err.message };
  }
}

function registerProfile(profile) {
  const globalConfig = profiles.loadGlobalConfig();
  const { cronSchedule, timezone } = profiles.resolveEffective(profile, globalConfig);

  const task = cron.schedule(cronSchedule, () => runProfileJob(profile.id), { timezone });
  taskMap.set(profile.id, task);
}

function unregisterProfile(id) {
  const task = taskMap.get(id);
  if (task) {
    task.stop();
    taskMap.delete(id);
  }
}

function rescheduleProfile(id) {
  unregisterProfile(id);
  const profile = profiles.getById(id);
  if (profile) registerProfile(profile);
}

function reloadAll() {
  for (const id of taskMap.keys()) {
    unregisterProfile(id);
  }
  const all = profiles.loadAll();
  for (const profile of all) {
    registerProfile(profile);
  }
}

function init(client) {
  clientRef = client;
  const all = profiles.loadAll();
  for (const profile of all) {
    registerProfile(profile);
  }
}

module.exports = {
  init,
  registerProfile,
  unregisterProfile,
  rescheduleProfile,
  reloadAll,
  runProfileJob
};
