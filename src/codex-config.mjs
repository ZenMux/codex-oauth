import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  apiBaseUrl,
  codexHome,
  installStatePath,
  modelCatalogPath,
} from './constants.mjs';
import { fetchProductionModelCatalog } from './model-catalog.mjs';

const providerHeader = '[model_providers.zenmux]';
const authHeader = '[model_providers.zenmux.auth]';
const featuresHeader = '[features]';
const multiAgentHeader = '[features.multi_agent_v2]';

function quoteToml(value) {
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicWrite(path, content, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, content, { mode });
  await chmod(temporaryPath, mode);
  await rename(temporaryPath, path);
}

function removeTable(lines, header) {
  const result = [];
  let skipping = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === header) {
      skipping = true;
      continue;
    }
    if (skipping && /^\[.+\]$/.test(trimmed)) skipping = false;
    if (!skipping) result.push(line);
  }
  return result;
}

function upsertTableSetting(lines, header, key, value) {
  const headerIndex = lines.findIndex(line => line.trim() === header);
  if (headerIndex === -1) {
    while (lines.length && lines.at(-1).trim() === '') lines.pop();
    lines.push('', header, `${key} = ${value}`);
    return lines;
  }
  let tableEnd = lines.length;
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(lines[index])) {
      tableEnd = index;
      break;
    }
  }
  const settingPattern = new RegExp(`^\\s*${key}\\s*=`);
  const before = lines.slice(0, headerIndex + 1);
  const table = lines.slice(headerIndex + 1, tableEnd)
    .filter(line => !settingPattern.test(line));
  return [...before, `${key} = ${value}`, ...table, ...lines.slice(tableEnd)];
}

function removeTableSetting(lines, header, key) {
  const headerIndex = lines.findIndex(line => line.trim() === header);
  if (headerIndex === -1) return lines;
  let tableEnd = lines.length;
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(lines[index])) {
      tableEnd = index;
      break;
    }
  }
  const settingPattern = new RegExp(`^\\s*${key}\\s*=`);
  return [
    ...lines.slice(0, headerIndex + 1),
    ...lines.slice(headerIndex + 1, tableEnd).filter(line => !settingPattern.test(line)),
    ...lines.slice(tableEnd),
  ];
}

export function updateCodexConfig(source, commandPath, catalogPath = modelCatalogPath) {
  let lines = source.replace(/\r\n/g, '\n').split('\n');
  lines = removeTable(lines, providerHeader);
  lines = removeTable(lines, authHeader);
  lines = lines.filter(line => line.trim() !== '# Added by @zenmux/codex-oauth.');
  while (lines.length && lines[0].trim() === '') lines.shift();

  const firstTable = lines.findIndex(line => /^\s*\[/.test(line));
  const rootEnd = firstTable === -1 ? lines.length : firstTable;
  const root = lines.slice(0, rootEnd).filter(line => (
    !/^\s*model_provider\s*=/.test(line)
    && !/^\s*model_catalog_json\s*=/.test(line)
    && !/^\s*web_search\s*=/.test(line)
  ));
  while (root.length && root.at(-1).trim() === '') root.pop();
  root.push(
    'model_provider = "zenmux"',
    `model_catalog_json = ${quoteToml(catalogPath)}`,
    'web_search = "disabled"',
    '',
  );
  lines = [...root, ...lines.slice(rootEnd)];
  lines = removeTableSetting(lines, featuresHeader, 'multi_agent_v2');
  lines = upsertTableSetting(lines, multiAgentHeader, 'tool_namespace', '"agents"');
  while (lines.length && lines.at(-1).trim() === '') lines.pop();

  lines.push(
    '',
    '# Added by @zenmux/codex-oauth.',
    providerHeader,
    'name = "ZenMux"',
    `base_url = ${quoteToml(apiBaseUrl)}`,
    'wire_api = "responses"',
    '',
    authHeader,
    `command = ${quoteToml(commandPath)}`,
    'args = ["token"]',
    // Keep Codex's opaque bearer cache effectively request-scoped. The helper
    // performs the actual expiry check and serialized OAuth refresh; a longer
    // Codex cache can otherwise survive laptop sleep with an expired token.
    'refresh_interval_ms = 1',
    'timeout_ms = 15000',
    '',
  );
  return lines.join('\n');
}

async function originalConfigForInstall(configPath, currentSource, previousState) {
  if (previousState) return previousState.original;
  if (currentSource?.includes('# Added by @zenmux/codex-oauth.')) {
    const legacyBackup = await readOptional(`${configPath}.bak`);
    if (legacyBackup !== null) return { existed: true, content: legacyBackup };
  }
  return { existed: currentSource !== null, content: currentSource || '' };
}

export async function installCodexConfig(executablePath = process.argv[1], options = {}) {
  const configPath = join(codexHome, 'config.toml');
  const currentSource = await readOptional(configPath);
  const previousStateSource = await readOptional(installStatePath);
  const previousState = previousStateSource ? JSON.parse(previousStateSource) : null;
  if (previousState?.config_path && previousState.config_path !== configPath) {
    throw new Error(`ZenMux restore state belongs to a different Codex config: ${previousState.config_path}`);
  }
  const original = await originalConfigForInstall(configPath, currentSource, previousState);
  const commandPath = await realpath(executablePath);
  const catalog = options.catalog || await fetchProductionModelCatalog(options.fetchImpl || fetch);
  const catalogSource = `${JSON.stringify(catalog, null, 2)}\n`;
  const updated = updateCodexConfig(currentSource || '', commandPath, modelCatalogPath);
  const state = {
    version: 1,
    config_path: configPath,
    original,
    installed_config_sha256: sha256(updated),
    catalog_path: modelCatalogPath,
  };

  await atomicWrite(modelCatalogPath, catalogSource);
  await atomicWrite(installStatePath, `${JSON.stringify(state, null, 2)}\n`);
  if (currentSource !== null) await copyFile(configPath, `${configPath}.bak`);
  await atomicWrite(configPath, updated);
  return { configPath, modelCatalogPath, modelCount: catalog.models.length };
}

export async function uninstallCodexConfig(options = {}) {
  const configPath = join(codexHome, 'config.toml');
  const stateSource = await readOptional(installStatePath);
  if (!stateSource) throw new Error('ZenMux Codex configuration is not installed or has no restore state');
  const state = JSON.parse(stateSource);
  if (state.config_path && state.config_path !== configPath) {
    throw new Error(`ZenMux restore state belongs to a different Codex config: ${state.config_path}`);
  }
  const currentSource = await readOptional(configPath);
  const changed = currentSource === null || sha256(currentSource) !== state.installed_config_sha256;
  if (changed && !options.force) {
    throw new Error('Codex config changed after ZenMux installation; rerun with `uninstall --force` to back it up and restore the original config');
  }
  if (changed && currentSource !== null) {
    await copyFile(configPath, `${configPath}.zenmux-uninstall.bak`);
  }

  if (state.original.existed) await atomicWrite(configPath, state.original.content);
  else if (currentSource !== null) await unlink(configPath);

  try {
    await unlink(state.catalog_path || modelCatalogPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await unlink(installStatePath);
  return { configPath, restored: state.original.existed };
}
