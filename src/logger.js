const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function todayLogPath() {
  const today = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `${today}.log`);
}

function appendEntry(entry) {
  ensureLogDir();
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry });
  fs.appendFileSync(todayLogPath(), line + '\n');
}

function logSend({ profileId, days, amount, status, error }) {
  appendEntry({ kind: 'job', profileId, days, amount, status, error: error || null });
}

function logEvent(type, meta = {}) {
  appendEntry({ kind: 'lifecycle', type, ...meta });
}

function logCommand({ command, args, result }) {
  appendEntry({ kind: 'command', command, args, result });
}

module.exports = { logSend, logEvent, logCommand };
