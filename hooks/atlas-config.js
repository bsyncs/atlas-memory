const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_MODE = 'full';
const MODES = ['off', 'lite', 'full', 'ultra'];

function normalizeMode(value) {
  if (typeof value !== 'string') return null;
  const mode = value.trim().toLowerCase();
  return MODES.includes(mode) ? mode : null;
}

function configDir() {
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, 'atlas-context');
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'atlas-context');
  }
  return path.join(os.homedir(), '.config', 'atlas-context');
}

function configPath() {
  return path.join(configDir(), 'config.json');
}

function readConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), 'utf8').replace(/^\uFEFF/, ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeConfig(update) {
  const next = { ...readConfig(), ...update };
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function defaultMode() {
  return normalizeMode(process.env.ATLAS_CONTEXT_DEFAULT_MODE) ||
    normalizeMode(readConfig().defaultMode) || DEFAULT_MODE;
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'on', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'off', 'no'].includes(normalized)) return false;
  return null;
}

function defaultWriteback() {
  const environment = normalizeBoolean(process.env.ATLAS_CONTEXT_WRITEBACK_DEFAULT);
  if (environment !== null) return environment;
  const configured = normalizeBoolean(readConfig().defaultWriteback);
  return configured === null ? false : configured;
}

function modeSettings(mode) {
  const normalized = normalizeMode(mode) || DEFAULT_MODE;
  if (normalized === 'lite') return { k: 3, maxHops: null, promptHydration: false };
  if (normalized === 'ultra') return { k: 10, maxHops: 3, promptHydration: true };
  if (normalized === 'off') return { k: 0, maxHops: null, promptHydration: false };
  return { k: 5, maxHops: 2, promptHydration: true };
}

function atlasSettings() {
  const config = readConfig();
  const positiveNumber = (value, fallback, minimum) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
  };
  return {
    baseUrl: String(process.env.ATLAS_BASE_URL || config.baseUrl || 'https://api.bsyncs.com').replace(/\/$/, ''),
    apiKey: process.env.ATLAS_API_KEY || '',
    persona: process.env.ATLAS_CONTEXT_PERSONA || config.persona || 'codex',
    sessionId: process.env.ATLAS_CONTEXT_SESSION_ID || config.sessionId || '',
    maxChars: positiveNumber(process.env.ATLAS_CONTEXT_MAX_CHARS || config.maxChars || 8000, 8000, 500),
    writebackMaxChars: positiveNumber(
      process.env.ATLAS_CONTEXT_WRITEBACK_MAX_CHARS || config.writebackMaxChars || 1200,
      1200,
      200,
    ),
    timeoutMs: positiveNumber(process.env.ATLAS_CONTEXT_TIMEOUT_MS || config.timeoutMs || 6000, 6000, 500),
  };
}

function isDeactivationCommand(text) {
  const value = String(text || '').trim().toLowerCase().replace(/[.!?\s]+$/, '');
  return value === 'stop atlas' || value === 'normal memory';
}

module.exports = {
  DEFAULT_MODE,
  MODES,
  atlasSettings,
  configPath,
  defaultMode,
  defaultWriteback,
  isDeactivationCommand,
  modeSettings,
  normalizeMode,
  normalizeBoolean,
  readConfig,
  writeConfig,
};
