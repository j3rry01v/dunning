const profiles = require('./profiles');
const scheduler = require('./scheduler');
const messaging = require('./messaging');
const whatsapp = require('./whatsapp');
const logger = require('./logger');

const HELP_TEXT = [
  'Commands:',
  '/help',
  '/list',
  '/status <id>',
  '/pause <id>',
  '/resume <id>',
  '/setamount <id> <amount>',
  '/setdate <id> <YYYY-MM-DD>',
  '/add <id> <phone> <amount> <YYYY-MM-DD>',
  '/remove <id> confirm',
  '/reload',
  '/send <id>'
].join('\n');

// WhatsApp ids sometimes carry a ":<device>" suffix (e.g. "9198765@c.us" vs
// "9198765:12@c.us") depending on which linked device sent/received the
// message. Strip it before comparing so self-chat detection isn't fooled by
// device-id noise.
function normalizeId(id) {
  if (!id) return id;
  return id.replace(/:\d+@/, '@');
}

function isSelfChatCommand(client, msg) {
  const myId = client.info && client.info.wid && client.info.wid._serialized;
  if (!myId) return false;
  const from = normalizeId(msg.from);
  const to = normalizeId(msg.to);
  const me = normalizeId(myId);
  return Boolean(msg.fromMe) && from === me && to === me;
}

function previewLine(profile, globalConfig) {
  const { messageTemplate } = profiles.resolveEffective(profile, globalConfig);
  const result = messaging.buildMessage(profile, messageTemplate);
  const state = profile.paused ? 'paused' : 'active';
  if (result.skip) {
    return `${profile.id} — ${state} — ${result.reason}`;
  }
  return `${profile.id} — ${state} — day ${result.days}, ₹${result.amount}/day`;
}

function handleList(globalConfig) {
  const all = profiles.loadAll();
  if (all.length === 0) return 'No profiles configured.';
  return all.map((p) => previewLine(p, globalConfig)).join('\n');
}

function handleStatus(args, globalConfig) {
  const [id] = args;
  const profile = profiles.getById(id);
  if (!profile) return `No such profile: ${id}`;
  return `${JSON.stringify(profile, null, 2)}\n\n${previewLine(profile, globalConfig)}`;
}

function handlePause(args) {
  const [id] = args;
  const profile = profiles.getById(id);
  if (!profile) return `No such profile: ${id}`;
  profile.paused = true;
  profiles.saveProfile(profile);
  scheduler.rescheduleProfile(id);
  return `Paused ${id}`;
}

function handleResume(args) {
  const [id] = args;
  const profile = profiles.getById(id);
  if (!profile) return `No such profile: ${id}`;
  profile.paused = false;
  profiles.saveProfile(profile);
  scheduler.rescheduleProfile(id);
  return `Resumed ${id}`;
}

function handleSetAmount(args) {
  const [id, amountStr] = args;
  const profile = profiles.getById(id);
  if (!profile) return `No such profile: ${id}`;
  const amount = Number(amountStr);
  if (!Number.isFinite(amount) || amount <= 0) return `Invalid amount: ${amountStr}`;
  profile.loanAmount = amount;
  profiles.saveProfile(profile);
  scheduler.rescheduleProfile(id);
  return `Updated ${id} loanAmount to ${amount}`;
}

function handleSetDate(args) {
  const [id, dateStr] = args;
  const profile = profiles.getById(id);
  if (!profile) return `No such profile: ${id}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return `Invalid date, expected YYYY-MM-DD: ${dateStr}`;
  profile.loanDateISO = dateStr;
  profiles.saveProfile(profile);
  scheduler.rescheduleProfile(id);
  return `Updated ${id} loanDateISO to ${dateStr}`;
}

function handleAdd(args) {
  const [id, phone, amountStr, dateStr] = args;
  if (!id || !phone || !amountStr || !dateStr) {
    return 'Usage: /add <id> <phone> <amount> <YYYY-MM-DD>';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return `Invalid date, expected YYYY-MM-DD: ${dateStr}`;
  const amount = Number(amountStr);
  if (!Number.isFinite(amount) || amount <= 0) return `Invalid amount: ${amountStr}`;

  try {
    const profile = profiles.createProfile({
      id,
      phone,
      loanAmount: amount,
      loanDateISO: dateStr
    });
    scheduler.registerProfile(profile);
    return `Added profile ${id}`;
  } catch (err) {
    return `Error: ${err.message}`;
  }
}

function handleRemove(args) {
  const [id, confirm] = args;
  const profile = profiles.getById(id);
  if (!profile) return `No such profile: ${id}`;
  if (confirm !== 'confirm') {
    return `To remove ${id}, send: /remove ${id} confirm`;
  }
  scheduler.unregisterProfile(id);
  profiles.deleteProfile(id);
  return `Removed ${id}`;
}

function handleReload() {
  scheduler.reloadAll();
  return 'Reloaded all profiles and config from disk.';
}

async function handleSend(args) {
  const [id] = args;
  const profile = profiles.getById(id);
  if (!profile) return `No such profile: ${id}`;

  const result = await scheduler.runProfileJob(id);
  switch (result.status) {
    case 'sent':
      return `Sent to ${id}: day ${result.days}, ₹${result.amount}/day\n\n${result.text}`;
    case 'skipped-paused':
      return `${id} is paused — resume it first with /resume ${id}`;
    case 'skipped-future-date':
      return `${id}'s loanDateISO is today or in the future (day ${result.days}) — nothing to send yet`;
    case 'skipped-not-ready':
      return 'WhatsApp client is not ready yet — try again in a moment';
    case 'error':
      return `Error sending to ${id}: ${result.error}`;
    default:
      return `Unexpected result: ${JSON.stringify(result)}`;
  }
}

async function handle(client, msg) {
  const body = msg.body.trim();
  if (!body.startsWith('/')) return;

  const [rawCommand, ...args] = body.split(/\s+/);
  const command = rawCommand.toLowerCase();
  const globalConfig = profiles.loadGlobalConfig();

  let reply;
  switch (command) {
    case '/help':
      reply = HELP_TEXT;
      break;
    case '/list':
      reply = handleList(globalConfig);
      break;
    case '/status':
      reply = handleStatus(args, globalConfig);
      break;
    case '/pause':
      reply = handlePause(args);
      break;
    case '/resume':
      reply = handleResume(args);
      break;
    case '/setamount':
      reply = handleSetAmount(args);
      break;
    case '/setdate':
      reply = handleSetDate(args);
      break;
    case '/add':
      reply = handleAdd(args);
      break;
    case '/remove':
      reply = handleRemove(args);
      break;
    case '/reload':
      reply = handleReload();
      break;
    case '/send':
      reply = await handleSend(args);
      break;
    default:
      reply = `Unknown command: ${command}\n\n${HELP_TEXT}`;
  }

  logger.logCommand({ command, args, result: reply });
  await whatsapp.sendSelf(client, reply);
}

function registerListener(client) {
  client.on('message_create', (msg) => {
    const myId = client.info && client.info.wid && client.info.wid._serialized;
    const matched = isSelfChatCommand(client, msg);

    // Always log what we saw — this is the trail to look at if commands
    // stop being recognized (e.g. WhatsApp changing id formats).
    logger.logEvent('message_seen', {
      myId,
      from: msg.from,
      to: msg.to,
      fromMe: msg.fromMe,
      body: msg.body,
      matchedSelfChat: matched
    });

    if (!matched) return;
    handle(client, msg).catch((err) => {
      logger.logEvent('command_error', { error: err.message });
    });
  });
}

module.exports = { registerListener, isSelfChatCommand };
