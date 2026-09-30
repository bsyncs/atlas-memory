const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8').replace(/^\uFEFF/, ''));
const portable = readJson('plugin.json');
const codex = readJson('.codex-plugin/plugin.json');
const portableMcp = readJson('mcp.json');
const codexMcp = readJson('.mcp.json');
const hooks = readJson('hooks/hooks.json');
const marketplace = readJson('.agents/plugins/marketplace.json');
const pkg = readJson('package.json');

const failures = [];
function expect(condition, message) { if (!condition) failures.push(message); }

expect(portable.name === codex.name && codex.name === 'atlas-memory', 'Manifest names must match Atlas Memory.');
expect(portable.version === codex.version && codex.version === pkg.version, 'Manifest/package versions must match.');
expect(portable.repository === 'https://github.com/bsyncs/atlas-memory', 'Portable manifest repository is incorrect.');
expect(codex.repository === 'https://github.com/bsyncs/atlas-memory', 'Codex manifest repository is incorrect.');
expect(codex.skills === './skills/', 'Codex skills path is missing.');
expect(fs.existsSync(path.join(root, 'hooks/hooks.json')), 'Default-discovery Codex hooks file is missing.');
expect(codex.mcpServers === './.mcp.json', 'Codex MCP path is missing.');
expect(portable.extensions?.['com.openai']?.hooks === './hooks/hooks.json', 'Portable OpenAI hooks extension is missing.');
expect(portableMcp.mcpServers?.atlas && codexMcp.mcpServers?.atlas, 'Atlas MCP server is missing.');
const marketplacePlugin = marketplace.plugins?.find((entry) => entry.name === 'atlas-memory');
expect(marketplace.name === 'bsyncs', 'Marketplace name must be bsyncs.');
expect(marketplacePlugin?.source?.url === 'https://github.com/bsyncs/atlas-memory.git', 'Marketplace source repository is incorrect.');
expect(marketplacePlugin?.source?.ref === `v${pkg.version}`, 'Marketplace source ref must match the package version tag.');
expect(marketplacePlugin?.policy?.installation === 'AVAILABLE', 'Marketplace installation policy is missing.');
expect(['ON_INSTALL', 'ON_USE'].includes(marketplacePlugin?.policy?.authentication), 'Marketplace authentication policy is invalid.');
for (const event of ['SessionStart', 'UserPromptSubmit', 'SubagentStart']) {
  expect(Array.isArray(hooks.hooks?.[event]), `${event} hook is missing.`);
}
for (const relative of [
  'README.md', 'AGENTS.md',
  'hooks/atlas-hydrate.js', 'mcp-server/index.mjs',
  'skills/atlas-context/SKILL.md', 'skills/atlas-memory/SKILL.md',
  'skills/atlas-reasoning/SKILL.md', 'skills/atlas-lifecycle/SKILL.md',
  'skills/atlas-help/SKILL.md',
]) expect(fs.existsSync(path.join(root, relative)), `Required file missing: ${relative}`);

if (failures.length) {
  for (const failure of failures) console.error(`ERROR: ${failure}`);
  process.exit(1);
}
console.log('Manifest and package invariants passed.');
