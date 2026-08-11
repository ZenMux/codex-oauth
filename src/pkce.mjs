import { createHash, randomBytes } from 'node:crypto';

function base64Url(buffer) {
  return buffer.toString('base64url');
}

export function createPkce() {
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function createState() {
  return base64Url(randomBytes(32));
}

export function buildAuthorizationUrl({
  origin,
  clientId,
  redirectUri,
  scope,
  state,
  challenge,
}) {
  const url = new URL(`${origin}/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url;
}
