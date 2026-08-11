import assert from 'node:assert/strict';
import test from 'node:test';
import { updateCodexConfig } from '../src/codex-config.mjs';

test('sets the root provider and replaces an API-key based ZenMux provider', () => {
  const source = `model = "openai/gpt-5.6-sol"
model_provider = "old"

[model_providers.zenmux]
name = "Old ZenMux"
base_url = "https://old.example/v1"
env_key = "ZENMUX_API_KEY"

[projects."/work"]
trust_level = "trusted"
`;
  const updated = updateCodexConfig(source, '/usr/local/bin/zenmux-codex-auth');
  assert.match(updated, /^model = "openai\/gpt-5\.6-sol"\nmodel_provider = "zenmux"/);
  assert.equal((updated.match(/\[model_providers\.zenmux\]/g) || []).length, 1);
  assert.equal((updated.match(/\[model_providers\.zenmux\.auth\]/g) || []).length, 1);
  assert.doesNotMatch(updated, /ZENMUX_API_KEY|old\.example/);
  assert.match(updated, /command = "\/usr\/local\/bin\/zenmux-codex-auth"/);
  assert.match(updated, /\[projects\."\/work"\]\ntrust_level = "trusted"/);
});

test('is idempotent', () => {
  const once = updateCodexConfig('', '/opt/zenmux-codex-auth');
  const twice = updateCodexConfig(once, '/opt/zenmux-codex-auth');
  assert.equal(twice, once);
});
