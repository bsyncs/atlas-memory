const fs = require('fs');
const path = require('path');
const { normalizeMode } = require('./atlas-config');

const stateDir = process.env.PLUGIN_DATA || path.join(process.cwd(), '.atlas-context-data');
const statePath = path.join(stateDir, '.atlas-context-active');
const writebackStatePath = path.join(stateDir, '.atlas-context-writeback.json');
const writebackReceiptPath = path.join(stateDir, '.atlas-context-writeback-receipts.json');
const turnScopePath = path.join(stateDir, '.atlas-context-turn-scopes.json');

function setMode(mode) {
  const normalized = normalizeMode(mode);
  if (!normalized || normalized === 'off') return clearMode();
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(statePath, normalized, 'utf8');
  return normalized;
}

function readMode() {
  try {
    return normalizeMode(fs.readFileSync(statePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function clearMode() {
  try { fs.unlinkSync(statePath); } catch (_) {}
  return 'off';
}

function readJson(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (_) {
    return {};
  }
}

function writeJson(file, value) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value), 'utf8');
}

function sessionKey(sessionId) {
  return String(sessionId || 'current');
}

function setWriteback(sessionId, enabled) {
  const state = readJson(writebackStatePath);
  state[sessionKey(sessionId)] = enabled === true;
  writeJson(writebackStatePath, state);
  return state[sessionKey(sessionId)];
}

function readWriteback(sessionId) {
  return readJson(writebackStatePath)[sessionKey(sessionId)] === true;
}

function writebackSetting(sessionId) {
  const value = readJson(writebackStatePath)[sessionKey(sessionId)];
  return typeof value === 'boolean' ? value : null;
}

function hasWritebackReceipt(sessionId, turnId) {
  if (!turnId) return false;
  const receipts = readJson(writebackReceiptPath);
  return receipts[sessionKey(sessionId)] === String(turnId);
}

function saveWritebackReceipt(sessionId, turnId) {
  if (!turnId) return;
  const receipts = readJson(writebackReceiptPath);
  receipts[sessionKey(sessionId)] = String(turnId);
  writeJson(writebackReceiptPath, receipts);
}

function saveTurnScope(hostSessionId, turnId, atlasSessionId, persona, decisionSummary = '') {
  const scopes = readJson(turnScopePath);
  scopes[sessionKey(hostSessionId)] = {
    turnId: turnId ? String(turnId) : null,
    atlasSessionId: String(atlasSessionId || ''),
    persona: String(persona || 'codex'),
    decisionSummary: String(decisionSummary || ''),
    decisionSaved: false,
    blocked: false,
  };
  writeJson(turnScopePath, scopes);
  return scopes[sessionKey(hostSessionId)];
}

function markTurnDecisionSaved(hostSessionId, turnId) {
  const scopes = readJson(turnScopePath);
  const key = sessionKey(hostSessionId);
  const scope = scopes[key];
  if (!scope || (turnId && scope.turnId && scope.turnId !== String(turnId))) return false;
  scope.decisionSaved = true;
  scopes[key] = scope;
  writeJson(turnScopePath, scopes);
  return true;
}

function readTurnScope(hostSessionId, turnId) {
  const scope = readJson(turnScopePath)[sessionKey(hostSessionId)];
  if (!scope || scope.blocked || !scope.atlasSessionId) return null;
  if (turnId && scope.turnId && scope.turnId !== String(turnId)) return null;
  return scope;
}

function blockTurnScope(hostSessionId) {
  const scopes = readJson(turnScopePath);
  scopes[sessionKey(hostSessionId)] = { blocked: true };
  writeJson(turnScopePath, scopes);
}

function hookOutput(event, context, message) {
  const output = {};
  if (message) output.systemMessage = message;
  if (context) {
    output.hookSpecificOutput = {
      hookEventName: event,
      additionalContext: context,
    };
  }
  return output;
}

function writeOutput(event, context = '', message = '') {
  try {
    process.stdout.write(JSON.stringify(hookOutput(event, context, message)));
  } catch (_) {}
}

module.exports = {
  blockTurnScope,
  clearMode,
  hasWritebackReceipt,
  hookOutput,
  markTurnDecisionSaved,
  readMode,
  readTurnScope,
  readWriteback,
  saveWritebackReceipt,
  saveTurnScope,
  setMode,
  setWriteback,
  statePath,
  writeOutput,
  writebackSetting,
  writebackStatePath,
  turnScopePath,
};
