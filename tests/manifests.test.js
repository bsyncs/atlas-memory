const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const json = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));

test('all JSON manifests parse and identify Atlas Memory', () => {
  assert.equal(json('plugin.json').name, 'atlas-memory');
  assert.equal(json('.codex-plugin/plugin.json').name, 'atlas-memory');
  assert.equal(json('plugin.json').repository, 'https://github.com/bsyncs/atlas-memory');
  assert.equal(json('.codex-plugin/plugin.json').repository, 'https://github.com/bsyncs/atlas-memory');
  assert.ok(json('mcp.json').mcpServers.atlas);
  assert.ok(json('.mcp.json').mcpServers.atlas);
  assert.ok(json('.mcp.json').mcpServers.atlas.env_vars.includes('ATLAS_API_KEY'));
  assert.ok(json('.mcp.json').mcpServers.atlas.env_vars.includes('ATLAS_CONTEXT_SESSION_ID'));
  assert.equal(json('.mcp.json').mcpServers.atlas.cwd, '.');
  assert.deepEqual(json('.mcp.json').mcpServers.atlas.args, ['mcp-server/index.mjs']);
  assert.ok(json('hooks/hooks.json').hooks.SessionStart);
  assert.ok(json('hooks/hooks.json').hooks.Stop);
  assert.equal(json('.agents/plugins/marketplace.json').plugins[0].name, 'atlas-memory');
});

test('skills have valid minimal frontmatter and unique names', () => {
  const skillRoot = path.join(root, 'skills');
  const names = new Set();
  for (const entry of fs.readdirSync(skillRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const text = fs.readFileSync(path.join(skillRoot, entry.name, 'SKILL.md'), 'utf8');
    assert.match(text, /^---\r?\nname: [a-z0-9-]+\r?\ndescription: .+\r?\n---/);
    const name = text.match(/\nname: ([^\r\n]+)/)[1];
    assert.equal(names.has(name), false);
    names.add(name);
  }
  assert.equal(names.size, 5);
});
