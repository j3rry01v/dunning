const whatsapp = require('./src/whatsapp');
const scheduler = require('./src/scheduler');
const commands = require('./src/commands');
const dashboard = require('./src/dashboard');
const alerts = require('./src/alerts');
const logger = require('./src/logger');

process.on('uncaughtException', (err) => {
  logger.logEvent('uncaught_exception', { error: err.message, stack: err.stack });
  console.error('Uncaught exception, exiting so PM2 can restart:', err);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  logger.logEvent('unhandled_rejection', { error: message, stack });
  console.error('Unhandled rejection, exiting so PM2 can restart:', err);
  process.exit(1);
});

const MAX_STARTUP_ATTEMPTS = 5;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attemptStartup(attempt) {
  const client = whatsapp.createClient();
  alerts.init(client);
  // Note: auth_failure/disconnected can't be alerted over WhatsApp itself
  // (the connection that would carry the alert is the thing that's down) —
  // those are visible in the dashboard's event feed instead. Alerts here are
  // for failures that happen while the client IS connected (e.g. a send error).

  return new Promise((resolve, reject) => {
    client.on('ready', () => {
      scheduler.init(client);
      commands.registerListener(client);
      dashboard.start(client);
      console.log('debt-reminder ready: profiles scheduled, admin commands listening on self-chat.');
      resolve();
    });

    client.initialize().catch(async (err) => {
      logger.logEvent('initialize_error', { attempt, error: err.message });
      console.error(`Startup attempt ${attempt} failed:`, err.message);
      try {
        await client.destroy();
      } catch {
        // best-effort cleanup, the browser may already be in a broken state
      }
      reject(err);
    });
  });
}

async function main() {
  for (let attempt = 1; attempt <= MAX_STARTUP_ATTEMPTS; attempt++) {
    try {
      await attemptStartup(attempt);
      return;
    } catch {
      // whatsapp-web.js's version-check page load is known to be flaky
      // against current Chrome/Puppeteer builds (throws a spurious
      // "Could not load response body for this request" error). Retrying
      // with a fresh browser/page usually succeeds within a couple of tries.
      if (attempt === MAX_STARTUP_ATTEMPTS) {
        console.error(`Giving up after ${MAX_STARTUP_ATTEMPTS} failed startup attempts.`);
        process.exit(1);
      }
      const backoffMs = 2000 * attempt;
      console.log(`Retrying startup in ${backoffMs}ms...`);
      await sleep(backoffMs);
    }
  }
}

main();
