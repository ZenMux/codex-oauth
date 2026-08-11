import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temporaryHome = await mkdtemp(join(tmpdir(), 'zenmux-codex-config-test-'));
const configPath = join(temporaryHome, 'config.toml');
process.env.CODEX_HOME = temporaryHome;
process.env.ZENMUX_OAUTH_STATE_DIR = join(temporaryHome, 'zenmux-state');
const installStatePath = join(process.env.ZENMUX_OAUTH_STATE_DIR, 'install.json');

const { installCodexConfig, uninstallCodexConfig } = await import('../src/codex-config.mjs');

const catalog = {
  models: [{
    slug: 'openai/gpt-test',
    display_name: 'ZenMux · GPT Test',
  }],
};

test('backs up and atomically installs a private Codex configuration', async () => {
  await mkdir(temporaryHome, { recursive: true });
  await writeFile(configPath, 'model = "test-model"\n', { mode: 0o644 });
  const result = await installCodexConfig(process.execPath, { catalog });

  assert.equal(await readFile(`${configPath}.bak`, 'utf8'), 'model = "test-model"\n');
  assert.match(await readFile(configPath, 'utf8'), /model_provider = "zenmux"/);
  assert.match(await readFile(configPath, 'utf8'), /model_catalog_json = /);
  assert.deepEqual(JSON.parse(await readFile(result.modelCatalogPath, 'utf8')), catalog);
  assert.equal((await stat(configPath)).mode & 0o777, 0o600);

  await uninstallCodexConfig();
  assert.equal(await readFile(configPath, 'utf8'), 'model = "test-model"\n');
  await assert.rejects(() => access(result.modelCatalogPath));
});

test('refuses to overwrite config changes unless forced and creates a recovery backup', async () => {
  await writeFile(configPath, 'model = "before"\n', { mode: 0o600 });
  await installCodexConfig(process.execPath, { catalog });
  await writeFile(configPath, 'model = "changed-after-install"\n', { mode: 0o600 });

  await assert.rejects(() => uninstallCodexConfig(), /config changed after ZenMux installation/);
  await uninstallCodexConfig({ force: true });
  assert.equal(await readFile(configPath, 'utf8'), 'model = "before"\n');
  assert.equal(
    await readFile(`${configPath}.zenmux-uninstall.bak`, 'utf8'),
    'model = "changed-after-install"\n',
  );
});

test('rejects restore state associated with another Codex config path', async () => {
  await writeFile(configPath, 'model = "path-bound"\n', { mode: 0o600 });
  await installCodexConfig(process.execPath, { catalog });
  const state = JSON.parse(await readFile(installStatePath, 'utf8'));
  state.config_path = join(temporaryHome, 'another-config.toml');
  await writeFile(installStatePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });

  await assert.rejects(
    () => installCodexConfig(process.execPath, { catalog }),
    /restore state belongs to a different Codex config/,
  );
  await assert.rejects(
    () => uninstallCodexConfig(),
    /restore state belongs to a different Codex config/,
  );

  state.config_path = configPath;
  await writeFile(installStatePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await uninstallCodexConfig();
});
