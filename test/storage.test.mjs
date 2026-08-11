import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const stateDir = await mkdtemp(join(tmpdir(), 'zenmux-codex-oauth-test-'));
process.env.ZENMUX_OAUTH_STORAGE = 'file';
process.env.ZENMUX_OAUTH_STATE_DIR = stateDir;

const {
  deleteCredentials,
  readCredentials,
  writeCredentials,
} = await import('../src/storage.mjs');

test('fallback credential storage is private and removable', async () => {
  const credentials = {
    access_token: 'test-access',
    refresh_token: 'test-refresh',
    expires_at: Date.now() + 60_000,
  };
  await writeCredentials(credentials);
  assert.deepEqual(await readCredentials(), credentials);

  const metadata = await stat(join(stateDir, 'credentials.json'));
  assert.equal(metadata.mode & 0o777, 0o600);

  await deleteCredentials();
  assert.equal(await readCredentials(), null);
});
