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
  const updated = updateCodexConfig(
    source,
    '/usr/local/bin/zenmux-codex-auth',
    '/home/user/.config/zenmux/codex-oauth/models.json',
  );
  assert.match(updated, /^model = "openai\/gpt-5\.6-sol"\nmodel_provider = "zenmux"/);
  assert.equal((updated.match(/\[model_providers\.zenmux\]/g) || []).length, 1);
  assert.equal((updated.match(/\[model_providers\.zenmux\.auth\]/g) || []).length, 1);
  assert.doesNotMatch(updated, /ZENMUX_API_KEY|old\.example/);
  assert.match(updated, /command = "\/usr\/local\/bin\/zenmux-codex-auth"/);
  assert.match(updated, /refresh_interval_ms = 300000/);
  assert.match(updated, /model_catalog_json = "\/home\/user\/\.config\/zenmux\/codex-oauth\/models\.json"/);
  assert.match(updated, /web_search = "disabled"/);
  assert.match(updated, /\[features\.multi_agent_v2\]\ntool_namespace = "agents"/);
  assert.match(updated, /\[projects\."\/work"\]\ntrust_level = "trusted"/);
});

test('replaces the Responses native web-search mode for cross-provider compatibility', () => {
  const updated = updateCodexConfig(
    'web_search = "live"\n',
    '/opt/zenmux-codex-auth',
    '/tmp/models.json',
  );
  assert.equal((updated.match(/web_search\s*=/g) || []).length, 1);
  assert.match(updated, /web_search = "disabled"/);
});

test('preserves other multi-agent settings while selecting the agents namespace', () => {
  const source = `[features.multi_agent_v2]
usage_hint_enabled = true
tool_namespace = "old"
`;
  const updated = updateCodexConfig(source, '/opt/zenmux-codex-auth', '/tmp/models.json');
  assert.match(updated, /\[features\.multi_agent_v2\]\ntool_namespace = "agents"\nusage_hint_enabled = true/);
  assert.equal((updated.match(/tool_namespace\s*=/g) || []).length, 1);
});

test('migrates the legacy multi_agent_v2 feature flag before creating its settings table', () => {
  const source = `[features]
hooks = true
multi_agent_v2 = true

[projects."/work"]
trust_level = "trusted"
`;
  const updated = updateCodexConfig(source, '/opt/zenmux-codex-auth', '/tmp/models.json');
  assert.match(updated, /\[features\]\nhooks = true/);
  assert.doesNotMatch(updated, /^multi_agent_v2\s*=/m);
  assert.match(updated, /\[features\.multi_agent_v2\]\ntool_namespace = "agents"/);
  assert.match(updated, /\[projects\."\/work"\]\ntrust_level = "trusted"/);
});

test('is idempotent', () => {
  const once = updateCodexConfig('', '/opt/zenmux-codex-auth', '/tmp/models.json');
  const twice = updateCodexConfig(once, '/opt/zenmux-codex-auth', '/tmp/models.json');
  assert.equal(twice, once);
});
