import { homedir } from 'node:os';
import { join } from 'node:path';

export const oauthOrigin = (process.env.ZENMUX_OAUTH_ORIGIN || 'https://zenmux.ai').replace(/\/$/, '');
export const productionOAuthOrigin = 'https://zenmux.ai';
export const productionOAuthClientId = 'zpc_3GWvxDXg8RhAUzhJPVdgMueR';
export const apiBaseUrl = (process.env.ZENMUX_API_BASE_URL || 'https://zenmux.ai/api/v1').replace(/\/$/, '');
export const modelsCatalogUrl = process.env.ZENMUX_MODELS_CATALOG_URL
  || `${oauthOrigin}/api/frontend/model/listByFilter?supported_protocol=responses`;
export const requestedScopes = (process.env.ZENMUX_OAUTH_SCOPES || 'inference:invoke offline_access')
  .trim()
  .split(/\s+/)
  .filter(Boolean)
  .join(' ');
export const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');
export const stateDir = process.env.ZENMUX_OAUTH_STATE_DIR
  || join(homedir(), '.config', 'zenmux', 'codex-oauth');
export const clientStatePath = join(stateDir, 'clients.json');
export const fallbackCredentialsPath = join(stateDir, 'credentials.json');
export const refreshLockPath = join(stateDir, 'refresh.lock');
export const modelCatalogPath = join(stateDir, 'models.json');
export const installStatePath = join(stateDir, 'install.json');
export const keychainService = 'ai.zenmux.codex-oauth';

export function credentialAccount(origin = oauthOrigin) {
  return new URL(origin).host;
}
