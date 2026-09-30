const crypto = require('crypto');
const path = require('path');

function projectName(cwd, fallback = 'current project') {
  const value = String(cwd || process.cwd()).replace(/[\\/]+$/, '');
  return value.split(/[\\/]/).filter(Boolean).at(-1) || fallback;
}

function normalizeSessionId(value) {
  if (typeof value !== 'string') return null;
  const sessionId = value.trim();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(sessionId)) return null;
  return sessionId;
}

function stableProjectSessionId(cwd) {
  const value = String(cwd || process.cwd());
  const isWindowsPath = /^[A-Za-z]:[\\/]/.test(value);
  const absolute = isWindowsPath ? path.win32.resolve(value) : path.resolve(value);
  const normalized = process.platform === 'win32' || isWindowsPath
    ? absolute.replace(/\\/g, '/').toLowerCase()
    : absolute;
  const project = projectName(absolute, 'project')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'project';
  const fingerprint = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  return `atlas-project:${project}:${fingerprint}`;
}

function resolveAtlasSessionId(cwd, configured) {
  return normalizeSessionId(configured) || stableProjectSessionId(cwd);
}

function newSharedSessionId() {
  return `atlas-shared:${crypto.randomUUID()}`;
}

module.exports = { newSharedSessionId, normalizeSessionId, projectName, resolveAtlasSessionId, stableProjectSessionId };
