const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

function exchange(messages, environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve(__dirname, '../mcp-server/index.mjs')], {
      stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ATLAS_API_KEY: '', ...environment },
    });
    let output = '';
    let errors = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { errors += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(errors || `MCP exited ${code}`));
      else resolve(output.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse));
    });
    for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
    child.stdin.end();
  });
}

test('MCP initializes and lists the complete active Atlas tool surface', async () => {
  const replies = await exchange([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ]);
  assert.equal(replies[0].result.serverInfo.name, 'atlas-memory');
  assert.match(replies[0].result.instructions, /call atlas_retrieve/);
  const names = replies[1].result.tools.map((tool) => tool.name);
  for (const expected of [
    'atlas_health', 'atlas_ingest', 'atlas_retrieve',
    'atlas_consolidate', 'atlas_prune',
    'atlas_schema', 'atlas_visualize_semantic', 'atlas_visualize_episodic',
    'atlas_cypher_readonly', 'atlas_admin_rebuild_index', 'atlas_admin_debug_semantic',
  ]) assert.ok(names.includes(expected), `missing ${expected}`);
  assert.equal(names.includes('atlas_ingest_batch'), false);
  assert.equal(names.includes('atlas_graph_qa'), false);
  assert.equal(names.includes('atlas_stats'), false);
});

test('MCP retrieval uses the selected shared session unless explicitly overridden', async () => {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-mcp-session-'));
  const configDir = path.join(configRoot, 'atlas-context');
  fs.mkdirSync(configDir);
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ sessionId: 'saved-shared-id' }));
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      requests.push(JSON.parse(body));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ facts: [] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const environment = {
      ATLAS_API_KEY: 'test-only-key',
      ATLAS_BASE_URL: `http://127.0.0.1:${server.address().port}`,
      ATLAS_CONTEXT_SESSION_ID: '',
      XDG_CONFIG_HOME: configRoot,
    };
    const call = (arguments_) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'atlas_retrieve', arguments: arguments_ } });
    await exchange([call({ query: 'saved' })], environment);
    await exchange([call({ query: 'explicit', session_id: 'pasted-id' })], environment);
    await exchange([call({ query: 'environment' })], { ...environment, ATLAS_CONTEXT_SESSION_ID: 'env-shared-id' });
    assert.deepEqual(requests.map((body) => body.session_id), ['saved-shared-id', 'pasted-id', 'env-shared-id']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(configRoot, { recursive: true, force: true });
  }
});

test('MCP does not expose the disabled Graph QA tool', async () => {
  const [reply] = await exchange([{
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'atlas_graph_qa', arguments: { query: 'How are these related?' } },
  }]);
  assert.equal(reply.error.code, -32602);
  assert.match(reply.error.message, /Unknown tool: atlas_graph_qa/);
});

test('MCP lifecycle tools stay inside the selected shared session', async () => {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-mcp-lifecycle-session-'));
  const configDir = path.join(configRoot, 'atlas-context');
  fs.mkdirSync(configDir);
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ sessionId: 'lifecycle-session-id' }));
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      requests.push({ path: request.url, body: JSON.parse(body) });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const environment = {
      ATLAS_API_KEY: 'test-only-key',
      ATLAS_BASE_URL: `http://127.0.0.1:${server.address().port}`,
      XDG_CONFIG_HOME: configRoot,
    };
    const call = (name, arguments_ = {}) => ({
      jsonrpc: '2.0', id: name, method: 'tools/call', params: { name, arguments: arguments_ },
    });
    await exchange([call('atlas_consolidate')], environment);
    await exchange([call('atlas_prune')], environment);
    assert.deepEqual(requests.map((request) => request.path), ['/brain/consolidate', '/brain/prune']);
    assert.deepEqual(requests.map((request) => request.body.session_id), [
      'lifecycle-session-id', 'lifecycle-session-id',
    ]);
    assert.equal(requests[1].body.dry_run, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(configRoot, { recursive: true, force: true });
  }
});

test('MCP saves request graph extraction by default', async () => {
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      requests.push({ path: request.url, body: JSON.parse(body) });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const environment = {
      ATLAS_API_KEY: 'test-only-key',
      ATLAS_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    };
    const call = (name, arguments_) => ({
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: arguments_ },
    });
    await exchange([call('atlas_ingest', { text: 'Atlas Memory uses prompt hooks.' })], environment);
    assert.equal(requests[0].path, '/brain/ingest');
    assert.equal(requests[0].body.use_llm_extraction, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('authenticated tools fail safely when the API key is absent', async () => {
  const [reply] = await exchange([
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'atlas_retrieve', arguments: { query: 'test' } } },
  ]);
  assert.equal(reply.result.isError, true);
  assert.match(reply.result.content[0].text, /ATLAS_API_KEY/);
});
