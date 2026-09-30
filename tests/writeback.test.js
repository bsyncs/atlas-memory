const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const { decisionCandidate, redactSensitive, summarize } = require('../hooks/atlas-writeback');

test('captures durable completed work and decisions concisely', () => {
  const summary = summarize([
    'Implemented the opt-in Stop hook and added receipt deduplication.',
    'Decision: writeback remains disabled by default.',
    'All tests passed.',
  ].join('\n'), 'atlas-context', 1200);
  assert.match(summary, /^Project atlas-context continuity update:/);
  assert.match(summary, /Implemented the opt-in Stop hook/);
  assert.match(summary, /disabled by default/);
  assert.match(summary, /All tests passed/);
});

test('rejects ordinary prompts, future plans, and transient debugging', () => {
  assert.equal(summarize('What should we work on next?', 'atlas-context'), '');
  assert.equal(summarize('I will implement this tomorrow.', 'atlas-context'), '');
  assert.equal(summarize('Debugging a temporary error; not completed.', 'atlas-context'), '');
});

test('captures explicit user decisions without treating questions as decisions', () => {
  assert.match(
    decisionCandidate('Atlas should store durable decisions after each completed conversation.'),
    /store durable decisions/,
  );
  assert.match(
    decisionCandidate('- Decision: keep automatic writeback opt-in and visible.'),
    /writeback opt-in and visible/,
  );
  assert.equal(decisionCandidate('Should Atlas store this conversation?'), '');
  assert.equal(decisionCandidate('What should we work on next?'), '');
});

test('removes code and redacts credentials and personal paths', () => {
  const text = [
    'Implemented secure configuration with api_key=super-secret-value.',
    'Updated C:\\Users\\Alice\\private\\settings.json.',
    'Completed the setting named `privateRuntimeToken`.',
    '```js',
    'const secret = "do-not-store";',
    '```',
  ].join('\n');
  const summary = summarize(text, 'atlas-context');
  assert.doesNotMatch(summary, /super-secret-value|do-not-store|privateRuntimeToken|Alice/);
  assert.match(summary, /\[REDACTED\]/);
  assert.match(summary, /%USERPROFILE%/);
  assert.doesNotMatch(redactSensitive('Bearer abc.def.ghi'), /abc\.def\.ghi/);
});

test('opted-in Stop hook stores and displays the exact same summary', { timeout: 15000 }, async () => {
  let requestBody;
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      requestBody = JSON.parse(body);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-writeback-state-'));
  const sessionId = 'session-test';
  fs.writeFileSync(
    path.join(stateDir, '.atlas-context-writeback.json'),
    JSON.stringify({ [sessionId]: true }),
  );
  fs.writeFileSync(
    path.join(stateDir, '.atlas-context-turn-scopes.json'),
    JSON.stringify({
      [sessionId]: {
        turnId: 'turn-test',
        atlasSessionId: 'atlas-project:atlas-context:0123456789abcdef',
        persona: 'codex',
        blocked: false,
      },
    }),
  );
  try {
    const address = server.address();
    const output = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.resolve(__dirname, '../hooks/atlas-writeback.js')], {
        env: {
          ...process.env,
          ATLAS_API_KEY: 'test-only-key',
          ATLAS_BASE_URL: `http://127.0.0.1:${address.port}`,
          PLUGIN_DATA: stateDir,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
      child.stdin.end(JSON.stringify({
        hook_event_name: 'Stop',
        session_id: sessionId,
        turn_id: 'turn-test',
        cwd: path.join(process.cwd(), 'atlas-context'),
        last_assistant_message: 'Implemented automatic continuity capture. All tests passed.',
      }));
    });
    const payload = JSON.parse(output);
    assert.equal(requestBody.use_llm_extraction, true);
    assert.equal(requestBody.source, 'automatic-writeback');
    assert.equal(requestBody.session_id, 'atlas-project:atlas-context:0123456789abcdef');
    assert.equal(requestBody.persona, 'codex');
    assert.equal(requestBody.metadata.codex_session_id, sessionId);
    assert.equal(requestBody.metadata.atlas_session_id, requestBody.session_id);
    assert.equal(payload.systemMessage, `Atlas stored this exact summary:\n${requestBody.text}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('a session switch blocks writeback from the previous turn scope', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-writeback-blocked-'));
  fs.writeFileSync(
    path.join(stateDir, '.atlas-context-writeback.json'),
    JSON.stringify({ 'host-session': true }),
  );
  fs.writeFileSync(
    path.join(stateDir, '.atlas-context-turn-scopes.json'),
    JSON.stringify({ 'host-session': { blocked: true } }),
  );
  try {
    const output = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.resolve(__dirname, '../hooks/atlas-writeback.js')], {
        env: { ...process.env, ATLAS_API_KEY: 'unused', PLUGIN_DATA: stateDir },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
      child.stdin.end(JSON.stringify({
        hook_event_name: 'Stop', session_id: 'host-session', turn_id: 'old-turn',
        last_assistant_message: 'Implemented a durable change. All tests passed.',
      }));
    });
    assert.deepEqual(JSON.parse(output), {});
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('PreCompact stores a pending user decision and surfaces the exact receipt', { timeout: 15000 }, async () => {
  let requestBody;
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      requestBody = JSON.parse(body);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-precompact-state-'));
  const sessionId = 'precompact-session';
  fs.writeFileSync(path.join(stateDir, '.atlas-context-writeback.json'), JSON.stringify({ [sessionId]: true }));
  fs.writeFileSync(path.join(stateDir, '.atlas-context-turn-scopes.json'), JSON.stringify({
    [sessionId]: {
      turnId: 'turn-precompact',
      atlasSessionId: 'atlas-project:atlas-context:precompact',
      persona: 'codex',
      decisionSummary: 'Atlas must preserve durable decisions before context compaction.',
      decisionSaved: false,
      blocked: false,
    },
  }));
  try {
    const output = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.resolve(__dirname, '../hooks/atlas-writeback.js')], {
        env: {
          ...process.env,
          ATLAS_API_KEY: 'test-only-key',
          ATLAS_BASE_URL: `http://127.0.0.1:${server.address().port}`,
          PLUGIN_DATA: stateDir,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
      child.stdin.end(JSON.stringify({
        hook_event_name: 'PreCompact',
        trigger: 'auto',
        session_id: sessionId,
        turn_id: 'turn-precompact',
        cwd: path.join(process.cwd(), 'atlas-context'),
      }));
    });
    const payload = JSON.parse(output);
    assert.equal(requestBody.metadata.capture, 'precompact-hook');
    assert.match(requestBody.text, /Decision or requirement: Atlas must preserve durable decisions/);
    assert.equal(payload.systemMessage, `Atlas stored this exact summary:\n${requestBody.text}`);
    const state = JSON.parse(fs.readFileSync(path.join(stateDir, '.atlas-context-turn-scopes.json'), 'utf8'));
    assert.equal(state[sessionId].decisionSaved, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('writeback visibly reports a completed check when nothing durable qualifies', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-writeback-empty-'));
  const sessionId = 'empty-session';
  fs.writeFileSync(path.join(stateDir, '.atlas-context-writeback.json'), JSON.stringify({ [sessionId]: true }));
  fs.writeFileSync(path.join(stateDir, '.atlas-context-turn-scopes.json'), JSON.stringify({
    [sessionId]: {
      turnId: 'turn-empty', atlasSessionId: 'atlas-project:atlas-context:empty', persona: 'codex',
      decisionSummary: '', decisionSaved: false, blocked: false,
    },
  }));
  try {
    const output = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.resolve(__dirname, '../hooks/atlas-writeback.js')], {
        env: { ...process.env, ATLAS_API_KEY: 'unused', PLUGIN_DATA: stateDir },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
      child.stdin.end(JSON.stringify({
        hook_event_name: 'Stop', session_id: sessionId, turn_id: 'turn-empty',
        cwd: process.cwd(), last_assistant_message: 'Thanks.',
      }));
    });
    assert.match(JSON.parse(output).systemMessage, /checked this turn; no durable update was stored/);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
