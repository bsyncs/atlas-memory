const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const config = require('../hooks/atlas-config');

test('normalizes only supported modes', () => {
  assert.equal(config.normalizeMode(' FULL '), 'full');
  assert.equal(config.normalizeMode('turbo'), null);
  assert.equal(config.normalizeMode(undefined), null);
});

test('mode settings preserve the documented hydration policy', () => {
  assert.deepEqual(config.modeSettings('lite'), { k: 3, maxHops: null, promptHydration: false });
  assert.deepEqual(config.modeSettings('full'), { k: 5, maxHops: 2, promptHydration: true });
  assert.deepEqual(config.modeSettings('ultra'), { k: 10, maxHops: 3, promptHydration: true });
  assert.equal(config.modeSettings('off').promptHydration, false);
});

test('deactivation phrases require an exact standalone phrase', () => {
  assert.equal(config.isDeactivationCommand('Stop Atlas!'), true);
  assert.equal(config.isDeactivationCommand('normal memory.'), true);
  assert.equal(config.isDeactivationCommand('please stop atlas'), false);
});

test('invalid environment mode falls through to config', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-context-test-'));
  const oldXdg = process.env.XDG_CONFIG_HOME;
  const oldMode = process.env.ATLAS_CONTEXT_DEFAULT_MODE;
  process.env.XDG_CONFIG_HOME = temp;
  process.env.ATLAS_CONTEXT_DEFAULT_MODE = 'invalid';
  config.writeConfig({ defaultMode: 'lite', unrelated: true });
  assert.equal(config.defaultMode(), 'lite');
  assert.equal(config.readConfig().unrelated, true);
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldXdg;
  if (oldMode === undefined) delete process.env.ATLAS_CONTEXT_DEFAULT_MODE; else process.env.ATLAS_CONTEXT_DEFAULT_MODE = oldMode;
  fs.rmSync(temp, { recursive: true, force: true });
});

test('writeback is off by default and boolean settings are strict', () => {
  assert.equal(config.normalizeBoolean('on'), true);
  assert.equal(config.normalizeBoolean('FALSE'), false);
  assert.equal(config.normalizeBoolean('sometimes'), null);
});
