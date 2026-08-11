import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temporaryHome = await mkdtemp(join(tmpdir(), 'zenmux-codex-config-test-'));
const configPath = join(temporaryHome, 'config.toml');
process.env.CODEX_HOME = temporaryHome;

const { installCodexConfig } = await import('../src/codex-config.mjs');

test('backs up and atomically installs a private Codex configuration', async () => {
  await mkdir(temporaryHome, { recursive: true });
  await writeFile(configPath, 'model = "test-model"\n', { mode: 0o644 });
  await installCodexConfig(process.execPath);

  assert.equal(await readFile(`${configPath}.bak`, 'utf8'), 'model = "test-model"\n');
  assert.match(await readFile(configPath, 'utf8'), /model_provider = "zenmux"/);
  assert.equal((await stat(configPath)).mode & 0o777, 0o600);
});
