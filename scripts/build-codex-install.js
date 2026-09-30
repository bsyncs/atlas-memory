const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist', 'codex');
const entries = [
  '.codex-plugin',
  '.mcp.json',
  '.env.example',
  'AGENTS.md',
  'README.md',
  'package.json',
  'hooks',
  'mcp-server',
  'skills',
];

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const entry of entries) {
  fs.cpSync(path.join(root, entry), path.join(output, entry), { recursive: true });
}

fs.rmSync(path.join(output, 'hooks', 'user-hooks.windows.json'), { force: true });

if (
  fs.existsSync(path.join(output, 'plugin.json')) ||
  fs.existsSync(path.join(output, '.env')) ||
  fs.existsSync(path.join(output, 'hooks', 'user-hooks.windows.json'))
) {
  throw new Error('Codex install artifact must omit the portable root manifest, secrets, and machine-specific files.');
}

console.log(`Codex compatibility artifact: ${output}`);
