import { createInterface } from 'node:readline';
import { parseOAuthCallback } from './oauth-callback.mjs';
import { recoverRefresh, refreshWithRecovery } from './refresh-recovery.mjs';
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
  deleteRefreshRecovery,
  readClientId,
  readCredentials,
  readRefreshRecovery,
  withRefreshLock,
  writeClientId,
  writeCredentials,
} from './storage.mjs';

export const defaultMinimumAccessTokenLifetimeMs = 10 * 60 * 1000;
export const oauthCompletionUrl = 'https://zenmux.ai/platform/oauth-completed?client=codex';

export function renderOAuthCompletionPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ZenMux authorization completed</title>
  <style>
    html, body, iframe { width: 100%; height: 100%; margin: 0; border: 0; }
    body { overflow: hidden; }
    iframe { display: block; }
  </style>
</head>
<body>
  <iframe src="${oauthCompletionUrl}" title="ZenMux authorization completed"></iframe>
</body>
</html>`;
}

export async function requestJson(url, options = {}, fetchImpl = fetch) {
  const { onStage, ...requestOptions } = options;
  const response = await fetchImpl(url, {
    ...requestOptions,
    signal: requestOptions.signal || AbortSignal.timeout(10_000),
  });
  onStage?.('response_headers', { status: response.status, requestId: /^[a-zA-Z0-9_-]{1,128}$/.test(response.headers.get('x-zenmux-requestid') || '') ? response.headers.get('x-zenmux-requestid') : undefined });
  const text = await response.text();
  onStage?.('response_body_read');
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`ZenMux returned a non-JSON response (${response.status})`);
  }
  onStage?.('response_parsed');
  if (!response.ok) {
    const error = new Error(payload.error_description || payload.message || payload.error || `ZenMux request failed (${response.status})`);
    error.oauthCode = ['invalid_grant', 'invalid_client', 'server_error', 'temporarily_unavailable'].includes(payload.error) ? payload.error : 'http_error';
    throw error;
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

export async function exchangeToken(parameters, fetchImpl = fetch, onStage) {
  return requestJson(`${oauthOrigin}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(parameters),
    onStage,
  }, fetchImpl);
}

export function normalizeCredentials(tokens, previousRefreshToken) {
  if (typeof tokens?.access_token !== 'string' || !tokens.access_token) throw new Error('ZenMux did not return an access token');
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

export function shouldOpenBrowser({ platform = process.platform, env = process.env, noBrowser = false } = {}) {
  if (noBrowser || env.ZENMUX_OAUTH_NO_BROWSER === '1') return false;
  if ([env.SSH_CONNECTION, env.SSH_CLIENT, env.SSH_TTY].some(value => value?.trim())) return false;
  if (platform !== 'darwin' && platform !== 'win32' && !env.DISPLAY?.trim() && !env.WAYLAND_DISPLAY?.trim()) return false;
  return true;
}

function openBrowser(url) {
  if (!shouldOpenBrowser()) return false;
  const command = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
  return true;
}

function waitForAuthorization({ clientId, challenge, state, noBrowser = false, timeoutMs = 5 * 60 * 1000 }) {
  return new Promise((resolve, reject) => {
    let redirectUri = '';
    let settled = false;
    let input;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input?.close();
      process.stdin.pause();
      process.stdin.unref?.();
      // A browser may leave speculative TCP connections with no HTTP request.
      // Allow the callback response to flush, but bound graceful shutdown.
      const shutdown = setTimeout(() => server.closeAllConnections(), 1000);
      shutdown.unref();
      server.close(() => clearTimeout(shutdown));
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
      let result;
      try {
        result = parseOAuthCallback(requestUrl.href, redirectUri, state);
      } catch {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Callback does not match this login session.');
        return;
      }
      if (result.error) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('ZenMux authorization failed. You can close this window.');
        finish(() => reject(new Error(result.error)));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(renderOAuthCompletionPage());
      finish(() => resolve({ code: result.code, redirectUri }));
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
      const opened = !noBrowser && openBrowser(authorizeUrl.toString());
      process.stderr.write(`${opened ? 'Opened' : 'Open'} this URL to authorize Codex:\n${authorizeUrl}\n`);
      process.stderr.write('Waiting for browser callback. For SSH/headless login, paste the complete callback URL below and press Enter.\nIf the browser cannot open 127.0.0.1, copy its address bar anyway. Do not share this URL.\nCallback URL / 粘贴回调地址: ');
      process.stdin.ref?.();
      input = createInterface({ input: process.stdin, terminal: false, crlfDelay: Infinity });
      input.on('line', line => {
        if (settled || !line.trim()) return;
        let result;
        try {
          result = parseOAuthCallback(line, redirectUri, state);
        } catch (error) {
          process.stderr.write(`\n${error.message}. Try again.\nCallback URL / 粘贴回调地址: `);
          return;
        }
        process.stderr.write('\n');
        if (result.error) {
          finish(() => reject(new Error(result.error)));
        } else {
          finish(() => resolve({ code: result.code, redirectUri }));
        }
      });
      input.on('error', () => finish(() => reject(new Error('Unable to read callback URL from stdin'))));
      // EOF only disables manual entry; automatic HTTP callback still works.

    });
    const timeout = setTimeout(() => {
      finish(() => reject(new Error('ZenMux OAuth callback timed out after 5 minutes')));
    }, timeoutMs);
    timeout.unref();
  });
}

export async function login(fetchImpl = fetch, options = {}) {
  const clientId = await registerClient(fetchImpl);
  const { verifier, challenge } = createPkce();
  const state = createState();
  const callback = await waitForAuthorization({ clientId, challenge, state, noBrowser: options.noBrowser });
  const tokens = await exchangeToken({
    grant_type: 'authorization_code',
    client_id: clientId,
    code: callback.code,
    redirect_uri: callback.redirectUri,
    code_verifier: verifier,
  }, fetchImpl);
  const credentials = normalizeCredentials(tokens);
  await withRefreshLock(async () => {
    await writeCredentials(credentials);
    await deleteRefreshRecovery();
  });
  return credentials;
}

async function refreshCredentialsLocked(credentials, fetchImpl) {
  return refreshWithRecovery(credentials, async onStage => {
    const clientId = await registerClient(fetchImpl);
    const tokens = await exchangeToken({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: credentials.refresh_token,
    }, fetchImpl, onStage);
    // ZenMux rotates on every refresh: retaining the consumed token is unsafe.
    if (typeof tokens.refresh_token !== 'string' || !tokens.refresh_token || tokens.refresh_token === credentials.refresh_token) {
      throw new Error('ZenMux did not return a new refresh token');
    }
    return normalizeCredentials(tokens);
  });
}

export async function refreshCredentials(credentials, fetchImpl = fetch) {
  return withRefreshLock(async () => {
    const current = await readCredentials();
    if (!current) throw new Error('Not signed in. Run `zenmux-codex-auth login` first.');
    const recovered = await recoverRefresh(current);
    // Another helper may have refreshed while this caller waited for the lock.
    if (recovered.refresh_token !== credentials.refresh_token) return recovered;
    return refreshCredentialsLocked(recovered, fetchImpl);
  });
}

export async function getAccessToken(options = {}) {
  return withRefreshLock(async () => {
    let credentials = await readCredentials();
    if (!credentials) throw new Error('Not signed in. Run `zenmux-codex-auth login` first.');
    if (typeof credentials.refresh_token !== 'string' || !credentials.refresh_token || !Number.isFinite(credentials.expires_at)) {
      throw new Error('Invalid saved OAuth credentials; run `zenmux-codex-auth login`');
    }
    credentials = await recoverRefresh(credentials);
    const minimumLifetimeMs = options.minimumLifetimeMs ?? defaultMinimumAccessTokenLifetimeMs;
    if (Number(credentials.expires_at) <= Date.now() + minimumLifetimeMs) {
      credentials = await refreshCredentialsLocked(credentials, options.fetchImpl || fetch);
    }
    return credentials.access_token;
  });
}

export async function getStatus() {
  const credentials = await readCredentials();
  const recovery = await readRefreshRecovery();
  return {
    signedIn: Boolean(credentials),
    refreshRecovery: recovery?.phase || null,
    expiresAt: credentials?.expires_at ? new Date(credentials.expires_at) : null,
    scopes: credentials?.scope || null,
    provider: apiBaseUrl,
    storage: process.platform === 'darwin' && process.env.ZENMUX_OAUTH_STORAGE !== 'file'
      ? 'macOS Keychain'
      : 'private file',
  };
}

export async function logout() {
  await withRefreshLock(async () => {
    await deleteCredentials();
    await deleteRefreshRecovery();
  });
}
