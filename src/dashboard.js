const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const profiles = require('./profiles');
const scheduler = require('./scheduler');
const whatsapp = require('./whatsapp');
const logger = require('./logger');

const TOKEN_PATH = path.join(__dirname, '..', '.dashboard_token');
const LOG_DIR = path.join(__dirname, '..', 'logs');
const startedAt = Date.now();

function getOrCreateToken() {
  if (fs.existsSync(TOKEN_PATH)) {
    return fs.readFileSync(TOKEN_PATH, 'utf8').trim();
  }
  const token = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(TOKEN_PATH, token);
  return token;
}

function readRecentEvents(limit = 50) {
  if (!fs.existsSync(LOG_DIR)) return [];
  const today = new Date().toISOString().slice(0, 10);
  const file = path.join(LOG_DIR, `${today}.log`);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  return lines
    .slice(-limit)
    .reverse()
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });
}

function buildStatus(globalConfig) {
  const all = profiles.loadAll();
  return {
    ready: whatsapp.getIsReady(),
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    now: new Date().toISOString(),
    profiles: all.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      phone: p.phone,
      paused: p.paused,
      debtAmount: p.debtAmount,
      debtDateISO: p.debtDateISO,
      cronSchedule: profiles.resolveEffective(p, globalConfig).cronSchedule,
      timezone: profiles.resolveEffective(p, globalConfig).timezone
    })),
    recentEvents: readRecentEvents(50)
  };
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function pageHtml(token) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>dunning control panel</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #0b0f14; color: #e6edf3; margin: 0; padding: 24px; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  .sub { color: #8b949e; font-size: 13px; margin-bottom: 20px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .ready { background: #1a7f37; color: white; }
  .not-ready { background: #a40e26; color: white; }
  .paused { background: #6e7681; color: white; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #21262d; font-size: 13px; }
  th { color: #8b949e; font-weight: 500; }
  button { background: #21262d; color: #e6edf3; border: 1px solid #30363d; border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px; margin-right: 4px; }
  button:hover { background: #30363d; }
  #events { font-family: ui-monospace, monospace; font-size: 12px; background: #161b22; border-radius: 6px; padding: 12px; max-height: 400px; overflow-y: auto; white-space: pre-wrap; }
  .event-line { padding: 2px 0; border-bottom: 1px solid #21262d; }
  .kind-command { color: #79c0ff; }
  .kind-lifecycle { color: #d29922; }
  .kind-job { color: #7ee787; }
  .kind-other { color: #e6edf3; }
</style>
</head>
<body>
<h1>dunning control panel</h1>
<div class="sub">Auto-refreshes every 5s. Localhost only.</div>
<div id="status"></div>
<h3>Profiles</h3>
<table id="profiles"><thead><tr><th>ID</th><th>Phone</th><th>State</th><th>Schedule</th><th>Actions</th></tr></thead><tbody></tbody></table>
<h3>Recent events (today)</h3>
<div id="events"></div>

<script>
const TOKEN = ${JSON.stringify(token)};

async function api(path, opts = {}) {
  const res = await fetch(path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(TOKEN), {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  return res.json();
}

async function action(id, verb) {
  await api('/api/profiles/' + encodeURIComponent(id) + '/' + verb, { method: 'POST' });
  refresh();
}

async function refresh() {
  const data = await api('/api/status');
  const statusEl = document.getElementById('status');
  statusEl.innerHTML = '<span class="badge ' + (data.ready ? 'ready' : 'not-ready') + '">' +
    (data.ready ? 'WhatsApp connected' : 'Not connected') + '</span> ' +
    '<span class="sub">uptime ' + data.uptimeSeconds + 's · ' + data.now + '</span>';

  const tbody = document.querySelector('#profiles tbody');
  tbody.innerHTML = '';
  for (const p of data.profiles) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + p.id + '</td>' +
      '<td>' + p.phone + '</td>' +
      '<td><span class="badge ' + (p.paused ? 'paused' : 'ready') + '">' + (p.paused ? 'paused' : 'active') + '</span></td>' +
      '<td>' + p.cronSchedule + ' (' + p.timezone + ')</td>' +
      '<td></td>';
    const actionsTd = tr.querySelector('td:last-child');
    const pauseBtn = document.createElement('button');
    pauseBtn.textContent = p.paused ? 'Resume' : 'Pause';
    pauseBtn.onclick = () => action(p.id, p.paused ? 'resume' : 'pause');
    const sendBtn = document.createElement('button');
    sendBtn.textContent = 'Send now (test)';
    sendBtn.onclick = () => action(p.id, 'send');
    actionsTd.appendChild(pauseBtn);
    actionsTd.appendChild(sendBtn);
    tbody.appendChild(tr);
  }

  const eventsEl = document.getElementById('events');
  eventsEl.innerHTML = data.recentEvents.map(e => {
    const cls = 'kind-' + (e.kind || 'other');
    return '<div class="event-line ' + cls + '">' + JSON.stringify(e) + '</div>';
  }).join('');
}

refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;
}

function checkToken(req, url, token) {
  const auth = req.headers.authorization;
  if (auth === `Bearer ${token}`) return true;
  if (url.searchParams.get('token') === token) return true;
  return false;
}

function start(client) {
  const globalConfig = profiles.loadGlobalConfig();
  const { port, host } = globalConfig.controlPanel || { port: 4173, host: '127.0.0.1' };
  const token = getOrCreateToken();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/') {
      const body = pageHtml(token);
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
      return;
    }

    if (!checkToken(req, url, token)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/status') {
      sendJson(res, 200, buildStatus(globalConfig));
      return;
    }

    const profileActionMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)\/(pause|resume|send)$/);
    if (req.method === 'POST' && profileActionMatch) {
      const [, id, verb] = profileActionMatch;
      const profile = profiles.getById(id);
      if (!profile) {
        sendJson(res, 404, { error: `no such profile: ${id}` });
        return;
      }

      if (verb === 'pause' || verb === 'resume') {
        profile.paused = verb === 'pause';
        profiles.saveProfile(profile);
        scheduler.rescheduleProfile(id);
        logger.logCommand({ command: `/${verb}`, args: [id], result: 'via dashboard' });
        sendJson(res, 200, { ok: true });
        return;
      }

      if (verb === 'send') {
        const result = await scheduler.runProfileJob(id);
        logger.logCommand({ command: '/send', args: [id], result });
        sendJson(res, 200, result);
        return;
      }
    }

    sendJson(res, 404, { error: 'not found' });
  });

  server.listen(port, host, () => {
    logger.logEvent('dashboard_started', { url: `http://${host}:${port}/?token=${token}` });
    console.log(`Control panel: http://${host}:${port}/?token=${token}`);
  });

  return server;
}

module.exports = { start };
