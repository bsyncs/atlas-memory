const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  newSharedSessionId,
  normalizeSessionId,
  resolveAtlasSessionId,
  stableProjectSessionId,
} = require('../hooks/atlas-session');

test('creates a stable Atlas working session for the same project root', () => {
  const cwd = path.resolve('workspace/project-a');
  assert.equal(stableProjectSessionId(cwd), stableProjectSessionId(cwd));
  assert.match(stableProjectSessionId(cwd), /^atlas-project:project-a:[a-f0-9]{16}$/);
  assert.notEqual(stableProjectSessionId(cwd), stableProjectSessionId(path.resolve('workspace/project-b')));
});

test('new shared IDs are valid and unique', () => {
  const first = newSharedSessionId();
  const second = newSharedSessionId();
  assert.match(first, /^atlas-shared:[a-f0-9-]{36}$/);
  assert.equal(normalizeSessionId(first), first);
  assert.notEqual(first, second);
});

test('explicit global Atlas session overrides the project-derived session', () => {
  assert.equal(resolveAtlasSessionId('/one/project', 'team.shared-session'), 'team.shared-session');
  assert.equal(resolveAtlasSessionId('/another/project', 'team.shared-session'), 'team.shared-session');
  assert.equal(normalizeSessionId('contains spaces'), null);
  assert.equal(normalizeSessionId(''), null);
});
