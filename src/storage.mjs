import { execFile } from 'node:child_process';
import { chmod, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
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
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
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

export async function readCredentials(origin = oauthOrigin) {
  if (usesMacKeychain()) {
    try {
      const { stdout } = await execFileAsync('security', [
        'find-generic-password',
        '-a', credentialAccount(origin),
        '-s', keychainService,
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
  const credentials = await readJson(fallbackCredentialsPath, {});
  return credentials[origin] || null;
}

export async function writeCredentials(credentials, origin = oauthOrigin) {
  if (usesMacKeychain()) {
    try {
      await execFileAsync('security', [
        'add-generic-password',
        '-a', credentialAccount(origin),
        '-s', keychainService,
        '-w', JSON.stringify(credentials),
        '-U',
      ], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    } catch {
      // Do not include the command error: Node may echo argv containing tokens.
      throw new Error('Unable to save credentials in macOS Keychain');
    }
    return;
  }
  const stored = await readJson(fallbackCredentialsPath, {});
  stored[origin] = credentials;
  await writePrivateJson(fallbackCredentialsPath, stored);
}

export async function deleteCredentials(origin = oauthOrigin) {
  if (usesMacKeychain()) {
    try {
      await execFileAsync('security', [
        'delete-generic-password',
        '-a', credentialAccount(origin),
        '-s', keychainService,
      ], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    } catch (error) {
      if (error.code !== 44 && !error.stderr?.includes('could not be found')) throw error;
    }
    return;
  }
  const stored = await readJson(fallbackCredentialsPath, {});
  delete stored[origin];
  await writePrivateJson(fallbackCredentialsPath, stored);
}

export async function withRefreshLock(operation, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5000;
  const retryMs = options.retryMs ?? 100;
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const deadline = Date.now() + timeoutMs;
  let handle;
  while (!handle) {
    try {
      handle = await open(refreshLockPath, 'wx', 0o600);
      await handle.writeFile(`${process.pid}\n`);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const ownerPid = Number((await readFile(refreshLockPath, 'utf8')).trim());
        if (!Number.isInteger(ownerPid) || ownerPid <= 0) {
          await unlink(refreshLockPath);
          continue;
        }
        try {
          process.kill(ownerPid, 0);
        } catch (ownerError) {
          if (ownerError.code === 'ESRCH') {
            await unlink(refreshLockPath);
            continue;
          }
        }
      } catch (lockError) {
        if (lockError.code === 'ENOENT') continue;
        throw lockError;
      }
      if (Date.now() >= deadline) throw new Error('Timed out waiting for another token refresh');
      await new Promise(resolve => setTimeout(resolve, retryMs));
    }
  }
  try {
    return await operation();
  } finally {
    await handle.close();
    await unlink(refreshLockPath).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}
