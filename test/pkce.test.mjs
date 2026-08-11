import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildAuthorizationUrl, createPkce } from '../src/pkce.mjs';

test('creates an RFC 7636 S256 verifier and challenge', () => {
  const { verifier, challenge } = createPkce();
  assert.match(verifier, /^[A-Za-z0-9_-]{64}$/);
  assert.equal(
    challenge,
    createHash('sha256').update(verifier).digest('base64url'),
  );
});

test('builds the authorization request with state and PKCE', () => {
  const url = buildAuthorizationUrl({
    origin: 'https://zenmux.ai',
    clientId: 'zpc_test',
    redirectUri: 'http://127.0.0.1:43123/callback',
    scope: 'inference:invoke offline_access',
    state: 'expected-state',
    challenge: 'a'.repeat(43),
  });
  assert.equal(url.pathname, '/oauth/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), 'zpc_test');
  assert.equal(url.searchParams.get('state'), 'expected-state');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});
