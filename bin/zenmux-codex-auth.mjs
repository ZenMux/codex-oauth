#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveProxyBootstrapEnv } from '../src/proxy.mjs';

const bootstrapEnv = resolveProxyBootstrapEnv({
  queryMacProxy: () => execFileSync('scutil', ['--proxy'], { encoding: 'utf8' }),
});

if (bootstrapEnv && process.env.ZENMUX_PROXY_BOOTSTRAPPED !== '1') {
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    env: {
      ...bootstrapEnv,
      ZENMUX_PROXY_BOOTSTRAPPED: '1',
    },
    stdio: 'inherit',
  });
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
}

const { runCli } = await import('../src/cli.mjs');
runCli(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`zenmux-codex-auth: ${error.message}\n`);
  process.exitCode = 1;
});
