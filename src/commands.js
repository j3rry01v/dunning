const fs = require('fs');
const path = require('path');

const profiles = require('./profiles');
const scheduler = require('./scheduler');
const messaging = require('./messaging');
const whatsapp = require('./whatsapp');
const logger = require('./logger');

const SELF_IDS_PATH = path.join(__dirname, '..', '.self_ids.json');

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
// message. Strip it before comparing so id matching isn't fooled by that.
function normalizeId(id) {
  if (!id) return id;
  return id.replace(/:\d+@/, '@');
}

// An account can be addressed two ways: the classic "<number>@c.us" and
// WhatsApp's newer "<opaque>@lid" (linked id). client.info only ever exposes
// the @c.us one, so comparing against it alone misses self-chat messages on
// accounts WhatsApp has moved to @lid addressing. We collect both here.
const selfIds = new Set();

function loadPersistedSelfIds() {
  try {
    for (const id of JSON.parse(fs.readFileSync(SELF_IDS_PATH, 'utf8'))) selfIds.add(id);
  } catch {
    // First run, or the file was removed — it gets rebuilt from observed traffic.
  }
}

function rememberSelfId(id) {
  const normalized = normalizeId(id);
  if (!normalized || normalized.endsWith('@g.us') || normalized === 'status@broadcast') return;
  if (selfIds.has(normalized)) return;

  selfIds.add(normalized);
  // Persisted so a restart doesn't go back to knowing only the @c.us form —
  // otherwise self-chat breaks again until traffic happens to re-reveal it.
  try {
    fs.writeFileSync(SELF_IDS_PATH, JSON.stringify([...selfIds], null, 2));
  } catch (err) {
    logger.logEvent('self_ids_persist_failed', { error: err.message });
  }
  logger.logEvent('self_identity_learned', { id: normalized, knownSelfIds: [...selfIds] });
}

// Every message reveals one of our own identities, in whichever format
// WhatsApp used for it: on a message we sent, `from` is us; on one we
// received, `to` is us (per whatsapp-web.js's Message docs). Collecting both
// is how the account's @lid identity gets discovered — client.info only ever
// reports the @c.us one.
function learnSelfIds(msg) {
  rememberSelfId(msg.fromMe ? msg.from : msg.to);
}

function isSelfChatCommand(client, msg) {
  if (!msg.fromMe) return false;

  const from = normalizeId(msg.from);
  const to = normalizeId(msg.to);
  if (!from || !to) return false;

  // Sender and recipient being the same entity *is* the definition of the
  // "Message Yourself" chat — and comparing them to each other rather than to
  // a known id works whichever addressing format WhatsApp picked for it.
  if (from === to) return true;

  // Mixed formats (e.g. sent as @c.us, chat keyed by @lid): fall back to
  // checking both sides against every identity we know this account by.
  const myId = client.info && client.info.wid && client.info.wid._serialized;
  if (myId) rememberSelfId(myId);
  return selfIds.has(from) && selfIds.has(to);
}

// Optional second control channel: commands sent from a configured admin
// number. Unlike self-chat, this is an ordinary incoming message, so it works
// regardless of how WhatsApp addresses your own account.
function isAdminPhoneCommand(msg, globalConfig) {
  if (msg.fromMe) return false;
  const adminPhone = globalConfig.adminPhone;
  if (!adminPhone) return false;
  return normalizeId(msg.from) === `${adminPhone}@c.us`;
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

async function handle(client, msg, replyToChatId) {
  const body = msg.body.trim();
  // Load-bearing: the bot's own replies land back here as self-chat messages,
  // so this "/" check is what stops a reply-to-a-reply loop. No reply text may
  // ever start with "/".
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
  await whatsapp.sendToChat(client, replyToChatId, reply);
}

function registerListener(client) {
  loadPersistedSelfIds();
  const myId = client.info && client.info.wid && client.info.wid._serialized;
  if (myId) rememberSelfId(myId);
  logger.logEvent('self_identity', { wid: myId, knownSelfIds: [...selfIds] });

  client.on('message_create', (msg) => {
    learnSelfIds(msg);

    // Cheap checks first: status broadcasts and group chatter arrive in
    // bursts, and there's no reason to hit the config files for those.
    const looksLikeCommand = typeof msg.body === 'string' && msg.body.trim().startsWith('/');
    const matchedSelfChat = isSelfChatCommand(client, msg);
    const matchedAdminPhone =
      !matchedSelfChat &&
      looksLikeCommand &&
      isAdminPhoneCommand(msg, profiles.loadGlobalConfig());

    // Always log what we saw — this is the trail to look at if commands
    // stop being recognized (e.g. WhatsApp changing id formats).
    logger.logEvent('message_seen', {
      myId,
      knownSelfIds: [...selfIds],
      from: msg.from,
      to: msg.to,
      fromMe: msg.fromMe,
      body: msg.body,
      matchedSelfChat,
      matchedAdminPhone
    });

    if (!matchedSelfChat && !matchedAdminPhone) return;

    // Same destination logic whatsapp-web.js's own Message.reply() uses: for
    // a message we sent (self-chat) the chat is `to`, for one we received
    // (admin phone) it's `from`. Left in WhatsApp's own id format rather than
    // normalized, since that's what's guaranteed to resolve to a real chat.
    const replyToChatId = msg.fromMe ? msg.to : msg.from;
    handle(client, msg, replyToChatId).catch((err) => {
      logger.logEvent('command_error', { error: err.message });
    });
  });
}

module.exports = { registerListener, isSelfChatCommand, isAdminPhoneCommand };
