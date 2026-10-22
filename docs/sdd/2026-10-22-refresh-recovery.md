# OAuth refresh recovery (0.2.10)

## Problem and scope
The server consumes a refresh token before the client can persist its successor.
The old PID-file lock also admitted two processes between file creation and PID
write. Fix the helper only; do not alter portal reuse detection or any deployed
credentials. Existing unrelated working-tree changes are excluded.

## Flow
- Use proper-lockfile 4.1.2's atomic mkdir lock, 10s heartbeat, 60s stale threshold,
  bounded 5s acquisition. Host auth.command timeout remains 15s; fetch stays 10s.
- Read current credentials and recover any journal while holding the lock.
- Persist `pending` with version, random attempt ID, predecessor SHA-256, timestamp.
- Execute one refresh request; require a nonempty, changed refresh token.
- Persist `received` with the validated replacement pair using the existing
  platform storage boundary (separate Keychain service, or mode-0600 JSON file).
- Save primary credentials with up to three local attempts, then clear recovery.
- On the next invocation, a received pair replaces the matching old credentials;
  a pending predecessor is never replayed. A different current credential means
  login/recovery already superseded that journal; discard it.
- Login saves and clears recovery under the same lock; logout also serializes.
- Temp files are flushed before atomic rename and cleaned on failure. This does
  not claim cross-device power-loss durability or solve the network commit gap.

## Diagnostics and security
JSON stderr events contain attempt ID, stage, bounded request ID, status/error
category and timestamps, never token values, raw bodies, cookies or arbitrary
exception text. Status reports pending/received state without mutation. Mac
recovery never falls back to plaintext files. No shared storage with Pi.

## Validation
Run full tests plus synthetic failure tests: reset/truncated/aborted response,
invalid_grant, missing refresh token, temporary/permanent primary-write failure,
journal-write failure, both writes failing, pending-write failure, stale journal
after new login, output redaction, private files and temp cleanup. Eight real
child processes sharing a store must cause exactly one HTTP refresh. Validate
packed installation on Poolab with synthetic credentials only.

## Rollout / limits
Do not run old and new helpers concurrently. A legacy PID lock is never blindly
deleted; stop its owner and verify staleness before manual cleanup. Pending
records conservatively require login even if a crash happened before sending.
The release prevents destructive automatic replay but cannot recover a truly
lost response; server-side idempotency remains separate work. No live login or
real token rotation is part of installation validation.
