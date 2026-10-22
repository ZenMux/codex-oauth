import { execFile } from 'node:child_process';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import lockfile from 'proper-lockfile';
import { promisify } from 'node:util';
import {
  clientStatePath,
  credentialAccount,
  fallbackCredentialsPath,
  keychainService,
  oauthOrigin,
  refreshLockPath,
  stateDir,
} from './constants.mjs';

const execFileAsync = promisify(execFile);

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'w', 0o600);
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
  } finally {
    await handle?.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function readClientId(origin = oauthOrigin) {
  const clients = await readJson(clientStatePath, {});
  return clients[origin] || null;
}

export async function writeClientId(clientId, origin = oauthOrigin) {
  const clients = await readJson(clientStatePath, {});
  clients[origin] = clientId;
  await writePrivateJson(clientStatePath, clients);
}

function usesMacKeychain() {
  return process.platform === 'darwin' && process.env.ZENMUX_OAUTH_STORAGE !== 'file';
}

async function readStored(origin, service, filePath) {
  if (usesMacKeychain()) {
    try {
      const { stdout } = await execFileAsync('security', [
        'find-generic-password',
        '-a', credentialAccount(origin),
        '-s', service,
        '-w',
      ], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
      return JSON.parse(stdout.trim());
    } catch (error) {
      if (error.code === 44 || error.code === 'ENOENT' || error.stderr?.includes('could not be found')) {
        return null;
      }
      throw new Error(`Unable to read credentials from macOS Keychain: ${error.message}`);
    }
  }
  const credentials = await readJson(filePath, {});
  return credentials[origin] || null;
}

async function writeStored(credentials, origin, service, filePath) {
  if (usesMacKeychain()) {
    try {
      await execFileAsync('security', [
        'add-generic-password',
        '-a', credentialAccount(origin),
        '-s', service,
        '-w', JSON.stringify(credentials),
        '-U',
      ], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    } catch {
      // Do not include the command error: Node may echo argv containing tokens.
      throw new Error('Unable to save credentials in macOS Keychain');
    }
    return;
  }
  const stored = await readJson(filePath, {});
  stored[origin] = credentials;
  await writePrivateJson(filePath, stored);
}

async function deleteStored(origin, service, filePath) {
  if (usesMacKeychain()) {
    try {
      await execFileAsync('security', [
        'delete-generic-password',
        '-a', credentialAccount(origin),
        '-s', service,
      ], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    } catch (error) {
      if (error.code !== 44 && !error.stderr?.includes('could not be found')) throw error;
    }
    return;
  }
  const stored = await readJson(filePath, {});
  delete stored[origin];
  await writePrivateJson(filePath, stored);
}

export const readCredentials = (origin = oauthOrigin) => readStored(origin, keychainService, fallbackCredentialsPath);
export const writeCredentials = (value, origin = oauthOrigin) => writeStored(value, origin, keychainService, fallbackCredentialsPath);
export const deleteCredentials = (origin = oauthOrigin) => deleteStored(origin, keychainService, fallbackCredentialsPath);

// Recovery data uses the same security boundary as the primary credentials.
const recoveryPath = join(stateDir, 'refresh-recovery.json');
const recoveryService = `${keychainService}.refresh-recovery`;
export const readRefreshRecovery = () => readStored(oauthOrigin, recoveryService, recoveryPath);
export const writeRefreshRecovery = value => writeStored(value, oauthOrigin, recoveryService, recoveryPath);
export const deleteRefreshRecovery = () => deleteStored(oauthOrigin, recoveryService, recoveryPath);

export async function withRefreshLock(operation, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5000;
  const retryMs = options.retryMs ?? 100;
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  // mkdir acquisition has no empty-PID-file window. A heartbeat allows recovery
  // after a killed helper, without deleting a live process's initializing lock.
  const release = await lockfile.lock(stateDir, {
    lockfilePath: refreshLockPath,
    stale: 60_000,
    update: 10_000,
    retries: { retries: Math.ceil(timeoutMs / retryMs), minTimeout: retryMs, maxTimeout: retryMs, factor: 1 },
  }).catch(error => {
    if (error.code === 'ELOCKED' || error.code === 'ENOTDIR') {
      throw new Error('Timed out waiting for another token refresh; stop old helper versions before upgrading');
    }
    throw error;
  });
  try {
    return await operation();
  } finally {
    await release();
  }
}
