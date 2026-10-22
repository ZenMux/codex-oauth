import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldOpenBrowser } from '../src/oauth.mjs';

for (const platform of ['darwin', 'win32', 'linux']) {
  for (const key of ['SSH_CONNECTION', 'SSH_CLIENT', 'SSH_TTY']) {
    test(`${platform}: ${key} suppresses browser even with display`, () => {
      assert.equal(shouldOpenBrowser({ platform, env: { [key]: 'remote', DISPLAY: ':0' } }), false);
    });
  }
  test(`${platform}: explicit opt outs suppress browser`, () => {
    assert.equal(shouldOpenBrowser({ platform, env: { DISPLAY: ':0' }, noBrowser: true }), false);
    assert.equal(shouldOpenBrowser({ platform, env: { DISPLAY: ':0', ZENMUX_OAUTH_NO_BROWSER: '1' } }), false);
  });
}
test('local macOS and Windows do not require Unix display variables', () => {
  for (const platform of ['darwin', 'win32']) assert.equal(shouldOpenBrowser({ platform, env: {} }), true);
});
test('Unix requires X11 or Wayland display', () => {
  for (const platform of ['linux', 'freebsd']) {
    assert.equal(shouldOpenBrowser({ platform, env: {} }), false);
    assert.equal(shouldOpenBrowser({ platform, env: { DISPLAY: ' ' } }), false);
    assert.equal(shouldOpenBrowser({ platform, env: { DISPLAY: ':0' } }), true);
    assert.equal(shouldOpenBrowser({ platform, env: { WAYLAND_DISPLAY: 'wayland-0' } }), true);
    assert.equal(shouldOpenBrowser({ platform, env: { DISPLAY: ':0', SSH_TTY: ' ' } }), true);
  }
});
