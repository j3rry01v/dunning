const fs = require('fs');
const path = require('path');

const PROFILES_DIR = path.join(__dirname, '..', 'profiles');
const CONFIG_PATH = path.join(__dirname, '..', 'config', 'default.json');
const LOCAL_CONFIG_PATH = path.join(__dirname, '..', 'config', 'local.json');
const TEMPLATE_PATH = path.join(__dirname, '..', 'config', 'message.template.txt');

// Used only if config/message.template.txt is ever missing, so a fresh
// checkout without that file still sends something sensible.
const FALLBACK_TEMPLATE =
  'ഇന്ന് എങ്കിലും അയക്കുമോ?\n{days} ദിവസം ആയി…\n\nDaily ₹{amount} വെച്ച് മാറ്റിവെച്ചിരുന്നെങ്കിൽ ഇപ്പൊ അയക്കായിരുന്നു.';

function ensureProfilesDir() {
  if (!fs.existsSync(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR, { recursive: true });
  }
}

function loadGlobalConfig() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

  // config/local.json is gitignored — personal overrides (e.g. alertPhone)
  // live there instead of in the tracked config/default.json.
  if (fs.existsSync(LOCAL_CONFIG_PATH)) {
    Object.assign(config, JSON.parse(fs.readFileSync(LOCAL_CONFIG_PATH, 'utf8')));
  }

  // The message template lives in its own plain-text file so it's easy to
  // hand-edit (no JSON string-escaping for newlines/placeholders).
  config.defaultMessageTemplate = fs.existsSync(TEMPLATE_PATH)
    ? fs.readFileSync(TEMPLATE_PATH, 'utf8').replace(/\n+$/, '')
    : FALLBACK_TEMPLATE;

  return config;
}

function profilePath(id) {
  return path.join(PROFILES_DIR, `${id}.json`);
}

function loadAll() {
  ensureProfilesDir();
  return fs
    .readdirSync(PROFILES_DIR)
    // Files starting with "_" (e.g. _example.json) are templates, not real
    // profiles to schedule.
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, f), 'utf8')));
}

function getById(id) {
  const file = profilePath(id);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveProfile(profile) {
  ensureProfilesDir();
  fs.writeFileSync(profilePath(profile.id), JSON.stringify(profile, null, 2));
  return profile;
}

function deleteProfile(id) {
  const file = profilePath(id);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function createProfile({ id, phone, loanAmount, loanDateISO, displayName }) {
  if (getById(id)) {
    throw new Error(`profile "${id}" already exists`);
  }
  const profile = {
    id,
    displayName: displayName || id,
    phone,
    loanAmount,
    loanDateISO,
    cronSchedule: null,
    timezone: null,
    messageTemplate: null,
    paused: false,
    createdAt: new Date().toISOString()
  };
  return saveProfile(profile);
}

function resolveEffective(profile, globalConfig) {
  return {
    cronSchedule: profile.cronSchedule || globalConfig.defaultCronSchedule,
    timezone: profile.timezone || globalConfig.timezone,
    messageTemplate: profile.messageTemplate || globalConfig.defaultMessageTemplate
  };
}

module.exports = {
  loadGlobalConfig,
  loadAll,
  getById,
  saveProfile,
  deleteProfile,
  createProfile,
  resolveEffective
};
