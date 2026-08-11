import { chmod, copyFile, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { apiBaseUrl, codexHome } from './constants.mjs';

const providerHeader = '[model_providers.zenmux]';
const authHeader = '[model_providers.zenmux.auth]';

function quoteToml(value) {
  return JSON.stringify(value);
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

export function updateCodexConfig(source, commandPath) {
  let lines = source.replace(/\r\n/g, '\n').split('\n');
  lines = removeTable(lines, providerHeader);
  lines = removeTable(lines, authHeader);
  lines = lines.filter(line => line.trim() !== '# Added by @zenmux/codex-oauth.');
  while (lines.length && lines[0].trim() === '') lines.shift();

  const firstTable = lines.findIndex(line => /^\s*\[/.test(line));
  const rootEnd = firstTable === -1 ? lines.length : firstTable;
  const root = lines.slice(0, rootEnd).filter(line => !/^\s*model_provider\s*=/.test(line));
  while (root.length && root.at(-1).trim() === '') root.pop();
  root.push('model_provider = "zenmux"', '');
  lines = [...root, ...lines.slice(rootEnd)];
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
    'refresh_interval_ms = 300000',
    'timeout_ms = 15000',
    '',
  );
  return lines.join('\n');
}

export async function installCodexConfig(executablePath = process.argv[1]) {
  const configPath = join(codexHome, 'config.toml');
  let source = '';
  let configExists = true;
  try {
    source = await readFile(configPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    configExists = false;
  }
  const commandPath = await realpath(executablePath);
  const updated = updateCodexConfig(source, commandPath);
  await mkdir(dirname(configPath), { recursive: true });
  if (configExists) await copyFile(configPath, `${configPath}.bak`);
  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, updated, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, configPath);
  return configPath;
}
