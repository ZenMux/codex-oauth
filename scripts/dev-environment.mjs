#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const devRoot = join(projectRoot, '.dev');
const codexHome = join(devRoot, 'codex-home');
const oauthState = join(devRoot, 'oauth-state');
const authExecutable = join(projectRoot, 'bin', 'zenmux-codex-auth.mjs');
const testModel = process.env.ZENMUX_TEST_MODEL || 'openai/gpt-5.6-sol';
const sourceModelCache = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'models_cache.json');
const testModelCatalog = join(devRoot, 'zenmux-model-catalog.json');

Object.assign(process.env, {
  CODEX_HOME: codexHome,
  ZENMUX_OAUTH_STATE_DIR: oauthState,
  ZENMUX_OAUTH_ORIGIN: process.env.ZENMUX_OAUTH_ORIGIN || 'https://zenmux.ai',
  ZENMUX_API_BASE_URL: process.env.ZENMUX_API_BASE_URL || 'https://zenmux.ai/api/v1',
});

async function ensureTestModel() {
  const configPath = join(codexHome, 'config.toml');
  const source = await readFile(configPath, 'utf8');
  const modelLine = `model = ${JSON.stringify(testModel)}`;
  let updated = /^\s*model\s*=/m.test(source)
    ? source.replace(/^\s*model\s*=.*$/m, modelLine)
    : `${modelLine}\n${source}`;
  const catalogLine = `model_catalog_json = ${JSON.stringify(testModelCatalog)}`;
  updated = /^\s*model_catalog_json\s*=/m.test(updated)
    ? updated.replace(/^\s*model_catalog_json\s*=.*$/m, catalogLine)
    : `${catalogLine}\n${updated}`;
  await writeFile(configPath, updated, { mode: 0o600 });
}

async function createTestModelCatalog() {
  const source = JSON.parse(await readFile(sourceModelCache, 'utf8'));
  const metadataSlug = testModel.split('/').at(-1);
  const metadata = source.models?.find(model => model.slug === metadataSlug);
  if (!metadata) {
    throw new Error(`Codex model metadata for ${metadataSlug} is unavailable in ${sourceModelCache}`);
  }
  const model = {
    ...metadata,
    slug: testModel,
    display_name: `ZenMux · ${metadata.display_name || metadataSlug}`,
    use_responses_lite: false,
    tool_mode: null,
    multi_agent_version: null,
  };
  await writeFile(testModelCatalog, `${JSON.stringify({ models: [model] }, null, 2)}\n`, { mode: 0o600 });
}

async function setup() {
  await mkdir(devRoot, { recursive: true });
  const { installCodexConfig } = await import('../src/codex-config.mjs');
  const configPath = await installCodexConfig(authExecutable);
  await createTestModelCatalog();
  await ensureTestModel();
  process.stdout.write(`Test Codex home: ${codexHome}\n`);
  process.stdout.write(`OAuth origin: ${process.env.ZENMUX_OAUTH_ORIGIN}\n`);
  process.stdout.write(`Model API: ${process.env.ZENMUX_API_BASE_URL}\n`);
  process.stdout.write(`Test model: ${testModel}\n`);
  process.stdout.write(`Config: ${configPath}\n`);
}

async function runCodex(args) {
  await setup();
  await new Promise((resolve, reject) => {
    const child = spawn('codex', args, { env: process.env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`Codex stopped by ${signal}`));
      else if (code) reject(new Error(`Codex exited with status ${code}`));
      else resolve();
    });
  });
}

async function runAuth(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(authExecutable, args, { env: process.env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`Authentication command stopped by ${signal}`));
      else if (code) reject(new Error(`Authentication command exited with status ${code}`));
      else resolve();
    });
  });
}

const [command = 'setup', ...args] = process.argv.slice(2);

if (command === 'setup') {
  await setup();
} else if (command === 'login') {
  await setup();
  await runAuth(['login']);
} else if (command === 'status') {
  await runAuth(['status']);
} else if (command === 'codex') {
  await runCodex(args);
} else {
  throw new Error(`Unknown development command: ${command}`);
}
