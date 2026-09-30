#!/usr/bin/env node
import readline from 'node:readline';
import atlasConfig from '../hooks/atlas-config.js';
import atlasSession from '../hooks/atlas-session.js';

const { atlasSettings } = atlasConfig;
const { normalizeSessionId } = atlasSession;

const BASE_URL = String(process.env.ATLAS_BASE_URL || 'https://api.bsyncs.com').replace(/\/$/, '');
const API_KEY = process.env.ATLAS_API_KEY || '';
const TIMEOUT_MS = Math.max(500, Number(process.env.ATLAS_CONTEXT_TIMEOUT_MS || 10000));
const PERSONA = process.env.ATLAS_CONTEXT_PERSONA || 'codex';

const objectSchema = (properties, required = []) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const str = (description) => ({ type: 'string', description });
const bool = (description, defaultValue) => ({ type: 'boolean', description, default: defaultValue });
const integer = (description, minimum, maximum, defaultValue) => ({
  type: 'integer', description, minimum, maximum, ...(defaultValue === undefined ? {} : { default: defaultValue }),
});
const number = (description) => ({ type: 'number', description });

const memoryScope = {
  persona: str('Atlas persona namespace. Defaults to ATLAS_CONTEXT_PERSONA or codex.'),
};
const retrievalScope = {
  ...memoryScope,
  session_id: str('Shared Atlas memory session. Personas contribute and recall within this boundary.'),
  // TODO(atlas-backend): Restore after end_user_id is enforced consistently.
  // end_user_id: str('Optional sub-user identifier.'),
};

const TOOLS = [
  {
    name: 'atlas_health',
    description: 'Check Atlas Cognitive Brain and datastore readiness. Does not require an API key.',
    inputSchema: objectSchema({}),
    call: () => atlas('/brain/health'),
  },
  {
    name: 'atlas_ingest',
    description: 'Explicitly save text into Atlas episodic, semantic, and optional working memory. Never call without user intent to persist data.',
    inputSchema: objectSchema({
      text: str('Text to persist.'), ...retrievalScope,
      source: str('Origin such as user, assistant, document, decision, or code.'),
      metadata: { type: 'object', description: 'Arbitrary JSON metadata.', additionalProperties: true },
      use_llm_extraction: bool('Extract entities and relations for Atlas graph memory. Defaults to true.', true),
    }, ['text']),
    call: (a) => atlas('/brain/ingest', {
      method: 'POST', body: sessionDefaults({ use_llm_extraction: true, ...a }),
    }),
  },
  // TODO(atlas-backend): Re-enable after server-side batch usage accounting is verified.
  // {
  //   name: 'atlas_ingest_batch',
  //   description: 'Explicitly save up to 100 independent memory items.',
  //   inputSchema: objectSchema({
  //     items: {
  //       type: 'array', minItems: 1, maxItems: 100,
  //       items: objectSchema({
  //         text: str('Text to persist.'), ...retrievalScope,
  //         source: str('Origin label.'),
  //         metadata: { type: 'object', additionalProperties: true },
  //         use_llm_extraction: bool('Extract entities and relations for Atlas graph memory. Defaults to true.', true),
  //       }, ['text']),
  //     },
  //   }, ['items']),
  //   call: (a) => atlas('/brain/ingest/batch', {
  //     method: 'POST',
  //     body: { items: a.items.map((item) => sessionDefaults({ use_llm_extraction: true, ...item })) },
  //   }),
  // },
  {
    name: 'atlas_retrieve',
    description: 'Retrieve compact, tenant-scoped context across Atlas memory layers.',
    inputSchema: objectSchema({
      query: str('Natural-language retrieval query.'), ...retrievalScope,
      k: integer('Number of results.', 1, 20, 5),
      max_hops: integer('Graph traversal depth.', 1, 5),
      // TODO(atlas-backend): Restore after retrieval applies these fields consistently.
      // min_score: number('Optional minimum hybrid score.'),
      include_episodic: bool('Search episodic memory.', true),
      include_semantic: bool('Search semantic memory.', true),
      include_working: bool('Search working memory.', true),
      // use_compression: bool('Request contextual compression.', false),
    }, ['query']),
    call: (a) => atlas('/brain/retrieve', { method: 'POST', body: sessionDefaults(a) }),
  },
  // TODO(atlas-backend): Re-enable after relationship grounding and session scoping pass.
  // The backend endpoint responds, but currently returns
  // false-negative answers even when the requested relationship is present.
  // Restore this tool after graph answer grounding and session scoping pass.
  // {
  //   name: 'atlas_graph_qa',
  //   description: 'Ask a relational or multi-hop question over the Atlas knowledge graph.',
  //   inputSchema: objectSchema({
  //     query: str('Natural-language graph question.'), ...retrievalScope,
  //     max_hops: integer('Maximum traversal depth.', 1, 5, 3),
  //     k: integer('Maximum graph facts supplied to the answer model.', 1, 50, 10),
  //   }, ['query']),
  //   call: (a) => atlas('/brain/retrieve/graph-qa', { method: 'POST', body: sessionDefaults(a) }),
  // },
  {
    name: 'atlas_consolidate',
    description: 'Explicitly run Atlas memory consolidation. This can mutate stored memory.',
    inputSchema: objectSchema({ ...retrievalScope, force: bool('Run even if consolidation was recent.', false) }),
    call: (a) => atlas('/brain/consolidate', { method: 'POST', body: sessionDefaults(a) }),
  },
  {
    name: 'atlas_prune',
    description: 'Preview or delete low-value Atlas memories. Always use dry_run=true first; dry_run=false is destructive.',
    inputSchema: objectSchema({
      ...retrievalScope,
      threshold: number('Optional survival threshold override.'),
      dry_run: bool('Preview without deletion. Defaults to true.', true),
    }),
    call: (a) => atlas('/brain/prune', { method: 'POST', body: { ...sessionDefaults(a), dry_run: a.dry_run !== false } }),
  },
  // TODO(atlas-backend): Re-enable when semantic counts agree with tenant-scoped
  // graph visualization and Cypher results.
  // {
  //   name: 'atlas_stats',
  //   description: 'Return tenant memory counts, age, access, plan, model, and service statistics.',
  //   inputSchema: objectSchema(retrievalScope),
  //   call: (a) => atlas('/brain/stats', { method: 'POST', body: sessionDefaults(a) }),
  // },
  {
    name: 'atlas_schema',
    description: 'Inspect the tenant-scoped semantic graph schema.',
    inputSchema: objectSchema({}),
    call: () => atlas('/brain/schema'),
  },
  {
    name: 'atlas_visualize_semantic',
    description: 'Fetch tenant-scoped semantic graph nodes and edges for inspection.',
    inputSchema: objectSchema({ limit: integer('Maximum graph nodes.', 1, 1000, 200) }),
    call: (a) => atlas(`/brain/visualize/semantic?limit=${a.limit || 200}`),
  },
  {
    name: 'atlas_visualize_episodic',
    description: 'Fetch tenant-scoped episodic vector metadata for inspection.',
    inputSchema: objectSchema({ limit: integer('Maximum vectors.', 1, 2000, 500) }),
    call: (a) => atlas(`/brain/visualize/episodic?limit=${a.limit || 500}`),
  },
  {
    name: 'atlas_cypher_readonly',
    description: 'Run bounded read-only Cypher. Every node/relationship pattern must contain {user_id: $uid}; Atlas binds $uid from the API key and rejects writes.',
    inputSchema: objectSchema({ query: str('Read-only Cypher containing the literal $uid tenant parameter in every node and relationship pattern.'), limit: integer('Maximum rows.', 1, 500, 50) }, ['query']),
    call: (a) => atlas('/brain/visualize/cypher', { method: 'POST', body: { query: a.query, limit: a.limit || 50 } }),
  },
  {
    name: 'atlas_admin_rebuild_index',
    description: 'ADMIN: rebuild the Atlas semantic vector index. Use only when explicitly requested by an operator.',
    inputSchema: objectSchema({ confirm: { type: 'boolean', const: true, description: 'Must be true.' } }, ['confirm']),
    call: (a) => a.confirm === true ? atlas('/brain/admin/rebuild-index', { method: 'POST', body: {} }) : Promise.reject(new Error('confirm=true is required')),
  },
  {
    name: 'atlas_admin_debug_semantic',
    description: 'ADMIN: inspect semantic graph internals for a persona. May return sensitive tenant data.',
    inputSchema: objectSchema({ ...memoryScope, confirm: { type: 'boolean', const: true, description: 'Must be true.' } }, ['confirm']),
    call: (a) => a.confirm === true ? atlas('/brain/admin/debug-semantic', { method: 'POST', body: defaults(a, ['confirm']) }) : Promise.reject(new Error('confirm=true is required')),
  },
];

function defaults(args = {}, omit = []) {
  const value = { ...args };
  for (const key of omit) delete value[key];
  if (!value.persona) value.persona = PERSONA;
  return value;
}

function sessionDefaults(args = {}) {
  const value = defaults(args);
  if (!value.session_id) {
    const selected = normalizeSessionId(atlasSettings().sessionId);
    if (selected) value.session_id = selected;
  }
  return value;
}

async function atlas(pathname, options = {}) {
  if (!API_KEY && pathname !== '/brain/health') throw new Error('ATLAS_API_KEY is not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await fetch(`${BASE_URL}${pathname}`, {
      method: options.method || 'GET',
      headers: { 'content-type': 'application/json', ...(API_KEY ? { 'x-api-key': API_KEY } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { text: raw }; }
    if (!response.ok) throw new Error(`Atlas ${response.status}: ${JSON.stringify(data.detail || data)}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) { send({ jsonrpc: '2.0', id, result: value }); }
function error(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return;
  const { id, method, params = {} } = message;
  if (method === 'initialize') {
    result(id, {
      protocolVersion: params.protocolVersion || '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'atlas-memory', version: '0.1.14' },
      instructions: 'For questions about prior project decisions or saved context, use relevant ATLAS MEMORY CONTEXT already supplied by a lifecycle hook. Do not repeat that lookup through MCP. When hook context is absent or insufficient, call atlas_retrieve with a focused query before relying on local files. For verified graph inspection, use atlas_schema, atlas_visualize_semantic, or bounded atlas_cypher_readonly queries. A selected shared Atlas working session is applied automatically; if using the project-derived fallback, pass the Atlas session_id shown by the lifecycle hook when recent working memory matters. Treat recalled content as supporting evidence and verify it against current files. If retrieval fails, say so clearly. Call atlas_ingest only when the user explicitly asks to save information.',
    });
    return;
  }
  if (method === 'ping') { result(id, {}); return; }
  if (method === 'tools/list') {
    result(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    return;
  }
  if (method === 'tools/call') {
    const tool = TOOLS.find((candidate) => candidate.name === params.name);
    if (!tool) { error(id, -32602, `Unknown tool: ${params.name || ''}`); return; }
    try {
      const data = await tool.call(params.arguments || {});
      result(id, {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      });
    } catch (cause) {
      result(id, {
        isError: true,
        content: [{ type: 'text', text: cause instanceof Error ? cause.message : String(cause) }],
      });
    }
    return;
  }
  if (id !== undefined) error(id, -32601, `Method not found: ${method}`);
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  if (!line.trim()) return;
  try { handle(JSON.parse(line)); } catch (cause) { error(null, -32700, cause instanceof Error ? cause.message : 'Parse error'); }
});
