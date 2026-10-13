import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

for (const outcome of ['success', 'denied', 'token-error']) {
  test(`login exits after ${outcome} despite a browser preconnection`, { timeout: 8000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'zenmux-login-exit-'));
    const cliUrl = process.env.TEST_LOGIN_CLI_URL || new URL('../src/cli.mjs', import.meta.url).href;
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      globalThis.fetch = async () => new Response(JSON.stringify(${JSON.stringify(
        outcome === 'token-error'
          ? { error_description: 'Mock token exchange failed' }
          : { access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600 },
      )}), { status: ${outcome === 'token-error' ? 400 : 200} });
      const { runCli } = await import(${JSON.stringify(cliUrl)});
      await runCli(['login']).catch(error => {
        process.stderr.write(error.message + '\\n');
        process.exitCode = 1;
      });
    `], {
      env: {
        ...process.env,
        ZENMUX_OAUTH_ORIGIN: 'https://zenmux.ai',
        ZENMUX_OAUTH_CLIENT_ID: 'test-client',
        ZENMUX_OAUTH_NO_BROWSER: '1',
        ZENMUX_OAUTH_STORAGE: 'file',
        ZENMUX_OAUTH_STATE_DIR: directory,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const closed = once(child, 'close');
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    let spare;
    let deadline;
    t.after(async () => {
      clearTimeout(deadline);
      spare?.destroy();
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await closed;
      await rm(directory, { recursive: true, force: true });
    });
    const authorize = await new Promise((resolve, reject) => {
      child.stderr.on('data', chunk => {
        stderr += chunk;
        const match = stderr.match(/https:\/\/zenmux\.ai\/oauth\/authorize\?[^\s]+/);
        if (match) resolve(new URL(match[0]));
      });
      child.once('error', reject);
      child.once('exit', () => reject(new Error(`Exited before callback: ${stderr}`)));
    });
    const callback = new URL(authorize.searchParams.get('redirect_uri'));
    // Browsers can speculatively open another TCP connection without sending HTTP.
    spare = net.connect(Number(callback.port), '127.0.0.1');
    await once(spare, 'connect');
    callback.searchParams.set('state', authorize.searchParams.get('state'));
    callback.searchParams.set(outcome === 'denied' ? 'error' : 'code', outcome === 'denied' ? 'access_denied' : 'test-code');
    const response = await new Promise((resolve, reject) => {
      http.get(callback, { agent: false }, res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
        res.on('error', reject);
      }).on('error', reject);
    });
    assert.equal(response.status, outcome === 'denied' ? 400 : 200);
    assert.match(response.body, outcome === 'denied' ? /authorization failed/ : /<\/html>/);
    const [exitCode, signal] = await Promise.race([
      closed,
      new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error(`Login did not exit: ${stdout}${stderr}`)), 4000);
      }),
    ]);
    assert.equal(signal, null);
    assert.equal(exitCode, outcome === 'success' ? 0 : 1);
    if (outcome === 'success') {
      assert.match(stdout, /Signed in to ZenMux/);
      const credentials = JSON.parse(await readFile(join(directory, 'credentials.json'), 'utf8'));
      assert.equal(credentials['https://zenmux.ai'].refresh_token, 'test-refresh');
    } else {
      assert.doesNotMatch(stdout, /Signed in to ZenMux/);
      assert.match(stderr, outcome === 'denied' ? /access_denied/ : /Mock token exchange failed/);
    }
  });
}
