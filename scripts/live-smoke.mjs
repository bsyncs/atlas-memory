#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verbose = process.argv.includes('--verbose');
const envPath = path.join(root, '.env');

function trace(message) {
  if (verbose) console.log(`[trace] ${message}`);
}

function loadEnv(filename) {
  if (!fs.existsSync(filename)) return;
  for (const raw of fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

loadEnv(envPath);
if (!process.env.ATLAS_API_KEY || process.env.ATLAS_API_KEY === 'replace-with-an-atlas-api-key') {
  console.error('FAIL configuration: ATLAS_API_KEY is missing or still a placeholder');
  process.exit(2);
}
trace(`configuration: env=${envPath}`);
trace(`configuration: baseUrl=${process.env.ATLAS_BASE_URL || 'https://api.bsyncs.com'}`);
trace(`configuration: persona=${process.env.ATLAS_CONTEXT_PERSONA || 'codex'}`);
trace('configuration: apiKey=present (value hidden)');
trace(`runtime: node=${process.version} platform=${process.platform}/${process.arch}`);

const child = spawn(process.execPath, [path.join(root, 'mcp-server', 'index.mjs')], {
  cwd: root,
  env: process.env,
  stdio: ['pipe', 'pipe', 'pipe'],
});
trace(`mcp: spawned pid=${child.pid || 'unknown'} transport=stdio`);
const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
const pending = new Map();
let nextId = 1;
let stderr = '';

child.stderr.on('data', (chunk) => { stderr += chunk; });
lines.on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  waiter.resolve(message);
});
child.on('exit', (code) => {
  for (const waiter of pending.values()) waiter.reject(new Error(`MCP exited ${code}: ${stderr.slice(0, 300)}`));
  pending.clear();
});

function request(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout waiting for ${method}`));
    }, 20000);
    timer.unref?.();
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

function safeSummary(name, value) {
  if (!value || typeof value !== 'object') return 'response received';
  if (name === 'atlas_health') {
    return `ready=${Boolean(value.ready)} models=${Boolean(value.models_loaded)} neo4j=${value.neo4j} redis=${value.redis} qdrant=${value.qdrant} version=${value.version}`;
  }
  if (name === 'atlas_retrieve') {
    return `contextChars=${String(value.context || '').length} facts=${value.facts?.length || 0} episodic=${value.episodic_count || 0} semantic=${value.semantic_count || 0} working=${value.working_count || 0} latencyMs=${value.latency_ms ?? 'n/a'}`;
  }
  if (name === 'atlas_schema') {
    const schema = value.schema || {};
    return `schemaFields=${Object.keys(schema).length}`;
  }
  if (name === 'atlas_visualize_semantic') return `nodes=${value.nodes?.length || 0} links=${value.links?.length || 0}`;
  if (name === 'atlas_visualize_episodic') return `points=${value.points?.length || 0} method=${value.method || 'n/a'}`;
  if (name === 'atlas_cypher_readonly') return `rows=${value.results?.length || 0}`;
  return `fields=${Object.keys(value).slice(0, 8).join(',') || 'none'}`;
}

let failures = 0;
try {
  trace('mcp -> initialize protocolVersion=2025-06-18');
  const init = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'atlas-live-smoke', version: '0.1.0' } });
  if (init.error) throw new Error(init.error.message);
  trace(`mcp <- initialized server=${init.result?.serverInfo?.name || 'unknown'} version=${init.result?.serverInfo?.version || 'unknown'}`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  const cases = [
    ['atlas_health', {}],
    ['atlas_retrieve', { query: 'Atlas Context plugin smoke test', k: 1, include_working: false }],
    ['atlas_schema', {}],
    ['atlas_visualize_semantic', { limit: 1 }],
    ['atlas_visualize_episodic', { limit: 1 }],
    ['atlas_cypher_readonly', { query: 'MATCH (n {user_id: $uid}) RETURN labels(n) AS labels LIMIT 1', limit: 1 }],
  ];

  for (const [name, args] of cases) {
    try {
      const started = performance.now();
      trace(`tool -> ${name} args=${JSON.stringify(args)}`);
      const reply = await request('tools/call', { name, arguments: args });
      if (reply.error) throw new Error(reply.error.message);
      if (reply.result?.isError) throw new Error(reply.result.content?.[0]?.text || 'tool error');
      const elapsed = Math.round(performance.now() - started);
      console.log(`PASS ${name} (${elapsed}ms): ${safeSummary(name, reply.result?.structuredContent)}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${name}: ${String(error.message || error).replace(/\b(?:atlas|sk|pk)_[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_KEY]')}`);
    }
  }
} finally {
  trace('mcp: closing stdin and waiting for clean shutdown');
  child.stdin.end();
  await new Promise((resolve) => child.once('close', resolve));
  trace('mcp: process closed');
}

if (failures) {
  console.error(`Live smoke completed with ${failures} failure(s).`);
  process.exit(1);
}
console.log('Live read-only smoke passed.');
