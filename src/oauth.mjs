import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import {
  apiBaseUrl,
  oauthOrigin,
  productionOAuthClientId,
  productionOAuthOrigin,
  requestedScopes,
} from './constants.mjs';
import { buildAuthorizationUrl, createPkce, createState } from './pkce.mjs';
import {
  deleteCredentials,
  readClientId,
  readCredentials,
  withRefreshLock,
  writeClientId,
  writeCredentials,
} from './storage.mjs';

export async function requestJson(url, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`ZenMux returned a non-JSON response (${response.status})`);
  }
  if (!response.ok) {
    throw new Error(payload.error_description || payload.message || payload.error || `ZenMux request failed (${response.status})`);
  }
  return payload;
}

export async function registerClient(fetchImpl = fetch) {
  const configured = process.env.ZENMUX_OAUTH_CLIENT_ID;
  if (configured) return configured;
  const cached = await readClientId();
  if (cached) return cached;
  if (oauthOrigin === productionOAuthOrigin) return productionOAuthClientId;
  const payload = await requestJson(`${oauthOrigin}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'ZenMux for Codex',
      application_type: 'native',
      token_endpoint_auth_method: 'none',
      redirect_uris: ['http://127.0.0.1/callback'],
      scope: requestedScopes,
    }),
  }, fetchImpl);
  if (!payload.client_id) throw new Error('ZenMux client registration did not return client_id');
  await writeClientId(payload.client_id);
  return payload.client_id;
}

export async function exchangeToken(parameters, fetchImpl = fetch) {
  return requestJson(`${oauthOrigin}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(parameters),
  }, fetchImpl);
}

export function normalizeCredentials(tokens, previousRefreshToken) {
  if (!tokens.access_token) throw new Error('ZenMux did not return an access token');
  const refreshToken = tokens.refresh_token || previousRefreshToken;
  if (!refreshToken) throw new Error('ZenMux did not return a refresh token');
  const expiresIn = Number(tokens.expires_in);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('ZenMux returned an invalid access-token lifetime');
  }
  return {
    access_token: tokens.access_token,
    refresh_token: refreshToken,
    expires_at: Date.now() + expiresIn * 1000,
    scope: tokens.scope || requestedScopes,
    token_type: tokens.token_type || 'Bearer',
  };
}

function openBrowser(url) {
  if (process.env.ZENMUX_OAUTH_NO_BROWSER === '1') return false;
  const command = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
  return true;
}

function waitForAuthorization({ clientId, challenge, state, timeoutMs = 5 * 60 * 1000 }) {
  return new Promise((resolve, reject) => {
    let redirectUri = '';
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.close();
      callback();
    };
    const server = createServer((request, response) => {
      if (!redirectUri || settled) {
        response.writeHead(409).end('OAuth callback is no longer active');
        return;
      }
      const requestUrl = new URL(request.url || '/', redirectUri);
      if (requestUrl.pathname !== '/callback') {
        response.writeHead(404).end('Not found');
        return;
      }
      const oauthError = requestUrl.searchParams.get('error');
      const errorDescription = requestUrl.searchParams.get('error_description');
      const returnedState = requestUrl.searchParams.get('state');
      const code = requestUrl.searchParams.get('code');
      if (oauthError || returnedState !== state || !code) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('ZenMux authorization failed. You can close this window.');
        finish(() => reject(new Error(errorDescription || oauthError || 'OAuth callback state mismatch')));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('ZenMux authorization completed. You can close this window and return to Codex.');
      finish(() => resolve({ code, redirectUri }));
    });
    server.on('error', error => finish(() => reject(error)));
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      redirectUri = `http://127.0.0.1:${address.port}/callback`;
      const authorizeUrl = buildAuthorizationUrl({
        origin: oauthOrigin,
        clientId,
        redirectUri,
        scope: requestedScopes,
        state,
        challenge,
      });
      const opened = openBrowser(authorizeUrl.toString());
      process.stderr.write(`${opened ? 'Opened' : 'Open'} this URL to authorize Codex:\n${authorizeUrl}\n`);
    });
    const timeout = setTimeout(() => {
      finish(() => reject(new Error('ZenMux OAuth callback timed out after 5 minutes')));
    }, timeoutMs);
    timeout.unref();
  });
}

export async function login(fetchImpl = fetch) {
  const clientId = await registerClient(fetchImpl);
  const { verifier, challenge } = createPkce();
  const state = createState();
  const callback = await waitForAuthorization({ clientId, challenge, state });
  const tokens = await exchangeToken({
    grant_type: 'authorization_code',
    client_id: clientId,
    code: callback.code,
    redirect_uri: callback.redirectUri,
    code_verifier: verifier,
  }, fetchImpl);
  const credentials = normalizeCredentials(tokens);
  await writeCredentials(credentials);
  return credentials;
}

export async function refreshCredentials(credentials, fetchImpl = fetch) {
  const clientId = await registerClient(fetchImpl);
  const tokens = await exchangeToken({
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: credentials.refresh_token,
  }, fetchImpl);
  const refreshed = normalizeCredentials(tokens, credentials.refresh_token);
  await writeCredentials(refreshed);
  return refreshed;
}

export async function getAccessToken(options = {}) {
  return withRefreshLock(async () => {
    let credentials = await readCredentials();
    if (!credentials) throw new Error('Not signed in. Run `zenmux-codex-auth login` first.');
    const minimumLifetimeMs = options.minimumLifetimeMs ?? 90_000;
    if (Number(credentials.expires_at) <= Date.now() + minimumLifetimeMs) {
      credentials = await refreshCredentials(credentials, options.fetchImpl || fetch);
    }
    return credentials.access_token;
  });
}

export async function getStatus() {
  const credentials = await readCredentials();
  return {
    signedIn: Boolean(credentials),
    expiresAt: credentials?.expires_at ? new Date(credentials.expires_at) : null,
    scopes: credentials?.scope || null,
    provider: apiBaseUrl,
    storage: process.platform === 'darwin' && process.env.ZENMUX_OAUTH_STORAGE !== 'file'
      ? 'macOS Keychain'
      : 'private file',
  };
}

export async function logout() {
  await deleteCredentials();
}
