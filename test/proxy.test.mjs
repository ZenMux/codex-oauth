import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMacHttpsProxy, resolveProxyBootstrapEnv } from '../src/proxy.mjs';

const macProxy = `
<dictionary> {
  HTTPEnable : 0
  HTTPSEnable : 1
  HTTPSPort : 13659
  HTTPSProxy : 127.0.0.1
}
`;

test('parses an enabled macOS HTTPS proxy', () => {
  assert.equal(parseMacHttpsProxy(macProxy), 'http://127.0.0.1:13659');
});

test('enables Node environment proxy support for an existing proxy', () => {
  const result = resolveProxyBootstrapEnv({
    env: { HTTPS_PROXY: 'http://proxy.example:8080' },
    platform: 'linux',
  });
  assert.equal(result.HTTPS_PROXY, 'http://proxy.example:8080');
  assert.equal(result.NODE_USE_ENV_PROXY, '1');
});

test('loads the macOS system proxy without hardcoding its address', () => {
  const result = resolveProxyBootstrapEnv({
    env: {},
    platform: 'darwin',
    queryMacProxy: () => macProxy,
  });
  assert.equal(result.HTTP_PROXY, 'http://127.0.0.1:13659');
  assert.equal(result.HTTPS_PROXY, 'http://127.0.0.1:13659');
  assert.equal(result.NODE_USE_ENV_PROXY, '1');
});
