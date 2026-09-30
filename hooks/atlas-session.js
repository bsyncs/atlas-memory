const crypto = require('crypto');
const path = require('path');

function normalizeSessionId(value) {
  if (typeof value !== 'string') return null;
  const sessionId = value.trim();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(sessionId)) return null;
  return sessionId;
}

function stableProjectSessionId(cwd) {
  const absolute = path.resolve(String(cwd || process.cwd()));
  const normalized = process.platform === 'win32'
    ? absolute.replace(/\\/g, '/').toLowerCase()
    : absolute;
  const project = (path.basename(absolute) || 'project')
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

module.exports = { newSharedSessionId, normalizeSessionId, resolveAtlasSessionId, stableProjectSessionId };
