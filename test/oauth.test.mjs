import assert from 'node:assert/strict';
import test from 'node:test';
import { productionOAuthClientId } from '../src/constants.mjs';
import {
  defaultMinimumAccessTokenLifetimeMs,
  normalizeCredentials,
  oauthCompletionUrl,
  renderOAuthCompletionPage,
  requestJson,
} from '../src/oauth.mjs';

test('ships one stable production OAuth public client', () => {
  assert.equal(productionOAuthClientId, 'zpc_3GWvxDXg8RhAUzhJPVdgMueR');
});

test('refreshes access tokens ten minutes before expiry', () => {
  assert.equal(defaultMinimumAccessTokenLifetimeMs, 10 * 60 * 1000);
});

test('renders the Codex completion page in a full-screen iframe', () => {
  const html = renderOAuthCompletionPage();
  assert.equal(oauthCompletionUrl, 'https://zenmux.ai/platform/oauth-completed?client=codex');
  assert.match(html, /<iframe src="https:\/\/zenmux\.ai\/platform\/oauth-completed\?client=codex"/);
  assert.match(html, /html, body, iframe \{ width: 100%; height: 100%; margin: 0; border: 0; \}/);
});

test('normalizes rotating OAuth credentials', () => {
  const before = Date.now();
  const credentials = normalizeCredentials({
    access_token: 'access-2',
    refresh_token: 'refresh-2',
    expires_in: 3600,
    token_type: 'Bearer',
    scope: 'inference:invoke offline_access',
  }, 'refresh-1');
  assert.equal(credentials.access_token, 'access-2');
  assert.equal(credentials.refresh_token, 'refresh-2');
  assert.ok(credentials.expires_at >= before + 3_600_000);
});

test('retains the current refresh token when the server omits rotation', () => {
  const credentials = normalizeCredentials({
    access_token: 'access-2',
    expires_in: 60,
  }, 'refresh-1');
  assert.equal(credentials.refresh_token, 'refresh-1');
});

test('surfaces OAuth error descriptions without exposing response bodies', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    error: 'invalid_grant',
    error_description: 'Refresh token is no longer valid',
  }), { status: 400, headers: { 'content-type': 'application/json' } });
  await assert.rejects(
    () => requestJson('https://zenmux.ai/oauth/token', {}, fetchImpl),
    /Refresh token is no longer valid/,
  );
});
