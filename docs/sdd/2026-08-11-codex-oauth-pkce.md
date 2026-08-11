# Codex OAuth PKCE provider authentication

## Context

Codex custom model providers accept command-backed Bearer authentication. ZenMux already exposes OAuth 2.0 Authorization Code with PKCE, native public-client registration, loopback redirects, refresh tokens, and a Responses-compatible model endpoint.

The integration must not copy OAuth tokens into `config.toml`, require a client secret, or route model traffic through a local proxy.

## Decision

Ship `@zenmux/codex-oauth` with a `zenmux-codex-auth` executable:

- `install` updates the user-level Codex configuration with the ZenMux Responses provider and an `auth.command` entry;
- `login` registers a native public client when necessary, starts an ephemeral `127.0.0.1` callback, verifies OAuth `state`, and exchanges the authorization code with an RFC 7636 S256 verifier;
- `token` returns only a valid access token on stdout for Codex and refreshes near-expiry credentials under a cross-process lock;
- `status` reports only non-sensitive metadata;
- `logout` removes OAuth credentials.

On macOS, access and refresh tokens are stored as one generic-password item in Keychain. Other platforms use a private JSON file with mode `0600` until native secure-store adapters are added.

## Security properties

- The public client has no embedded secret.
- Authorization uses a fresh verifier, challenge, and state for every login.
- The callback binds only to the IPv4 loopback interface on an ephemeral port.
- Only `inference:invoke offline_access` is requested by default.
- Refresh-token rotation is persisted before the refreshed access token is returned.
- Concurrent token commands serialize refresh through an exclusive lock file.
- A crashed refresh process cannot leave a permanent lock; a later command removes locks owned by dead processes.
- Tokens are never written to Codex configuration or status output.

## Compatibility boundary

The Codex provider uses the Responses wire API. MCP OAuth is intentionally not used because MCP credentials authenticate tool servers rather than model-provider requests.

The installer backs up an existing configuration, preserves unrelated user configuration, replaces an existing `model_providers.zenmux` table, and atomically writes `model_provider = "zenmux"` at the TOML root before the first table.

## Verification

Automated tests cover PKCE derivation, authorization parameters, token rotation normalization, safe OAuth errors, replacement of API-key provider configuration, preservation of unrelated tables, and installer idempotency. Plugin validation and npm pack inspection are required before release.
