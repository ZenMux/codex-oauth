import { createHash, randomUUID } from 'node:crypto';
import {
  readRefreshRecovery, writeRefreshRecovery, deleteRefreshRecovery, writeCredentials,
} from './storage.mjs';

const fingerprint = credentials => createHash('sha256').update(credentials.refresh_token).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export function refreshEvent(attemptId, event, fields = {}) {
  process.stderr.write(`${JSON.stringify({ component: 'zenmux-oauth-refresh', attemptId, event, time: new Date().toISOString(), ...fields })}\n`);
}
async function persist(operation) {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); } catch (error) {
      if (attempt === 2) throw error;
      await pause(100 * (attempt + 1));
    }
  }
}
async function clearRecovery(attemptId) {
  try { await persist(deleteRefreshRecovery); } catch {
    // A received journal is safe to replay; never lose an already saved pair
    // merely because journal cleanup failed.
    refreshEvent(attemptId, 'journal_cleanup_failed');
  }
}

export async function recoverRefresh(credentials) {
  const recovery = await readRefreshRecovery();
  if (!recovery) return credentials;
  if (recovery.version !== 1 || !['pending', 'received'].includes(recovery.phase)) {
    throw new Error('Invalid refresh recovery state; run `zenmux-codex-auth login` to reauthorize');
  }
  if (fingerprint(credentials) !== recovery.previousHash) {
    // Login or a previous recovery already installed a different credential.
    await clearRecovery(recovery.attemptId);
    return credentials;
  }
  if (recovery.phase === 'pending') {
    refreshEvent(recovery.attemptId, 'unsafe_retry_blocked');
    throw new Error('Previous refresh outcome is unknown; refusing to reuse the old refresh token. Run `zenmux-codex-auth login` to reauthorize');
  }
  const next = recovery.credentials;
  if (!next || typeof next.access_token !== 'string' || !next.access_token ||
      typeof next.refresh_token !== 'string' || !next.refresh_token ||
      !Number.isFinite(next.expires_at)) {
    throw new Error('Invalid recovered credentials; run `zenmux-codex-auth login` to reauthorize');
  }
  await persist(() => writeCredentials(next));
  refreshEvent(recovery.attemptId, 'credentials_recovered');
  await clearRecovery(recovery.attemptId);
  return next;
}

// Called under the same lock as the credential read and any recovery.
export async function refreshWithRecovery(credentials, exchange) {
  const attemptId = randomUUID();
  const pending = { version: 1, phase: 'pending', attemptId, previousHash: fingerprint(credentials), startedAt: new Date().toISOString() };
  await persist(() => writeRefreshRecovery(pending));
  refreshEvent(attemptId, 'request_started');
  let next;
  try {
    next = await exchange((event, fields) => refreshEvent(attemptId, event, fields));
  } catch (error) {
    const category = error.oauthCode || (['TimeoutError', 'AbortError', 'SyntaxError'].includes(error.name) ? error.name : 'transport_or_validation_error');
    refreshEvent(attemptId, 'request_or_validation_failed', { category });
    throw new Error('Refresh did not complete safely; the old refresh token will not be retried. Run `zenmux-codex-auth login` to reauthorize');
  }
  let journalSaved = false;
  try {
    await persist(() => writeRefreshRecovery({ ...pending, phase: 'received', credentials: next }));
    journalSaved = true;
    refreshEvent(attemptId, 'recovery_saved');
  } catch {
    refreshEvent(attemptId, 'recovery_save_failed');
  }
  try {
    await persist(() => writeCredentials(next));
  } catch {
    refreshEvent(attemptId, 'credential_save_failed', { recoverable: journalSaved });
    throw new Error(journalSaved
      ? 'New credentials are safely journaled but could not be installed; retry the token command to recover without another network refresh'
      : 'Unable to persist refreshed credentials; run `zenmux-codex-auth login` to reauthorize');
  }
  refreshEvent(attemptId, 'credentials_saved');
  await clearRecovery(attemptId);
  return next;
}
