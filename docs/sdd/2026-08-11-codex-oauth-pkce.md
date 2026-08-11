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
- On macOS, a configured system HTTPS proxy is detected and passed through Node's environment-proxy support without persisting the machine-specific proxy address.
- Tokens are never written to Codex configuration or status output.

## Compatibility boundary

The Codex provider uses the Responses wire API. MCP OAuth is intentionally not used because MCP credentials authenticate tool servers rather than model-provider requests.

The installer backs up an existing configuration, preserves unrelated user configuration, replaces an existing `model_providers.zenmux` table, and atomically writes `model_provider = "zenmux"` at the TOML root before the first table.

The production installer queries `/api/frontend/model/listByFilter?supported_protocol=responses`, defensively keeps only entries whose `suitable_api` contains the exact `responses` protocol, writes a private Codex-schema catalog under the OAuth state directory, and configures its path through root-level `model_catalog_json`. OpenAI GPT-series entries use their first production native alias (for example `gpt-5.6-sol`) to preserve Codex model-specific behavior; other providers retain their full ZenMux slug. The catalog disables first-party-only Responses Lite and hosted tool mode. OpenAI GPT entries set `multi_agent_version` to `v2`, while config sets `[features.multi_agent_v2] tool_namespace = "agents"`, so Codex 0.144.1 and newer avoid conflicts with model-reserved `collaboration` tool names. Other model families leave the explicit version unset (`null`) and follow Codex's default multi-agent behavior.

Legacy Codex configurations may enable the feature as `multi_agent_v2 = true` inside `[features]`. Before creating the nested `[features.multi_agent_v2]` settings table, install removes that Boolean entry; retaining both forms makes the TOML invalid because `multi_agent_v2` cannot be both a scalar and a table. Exact uninstall restoration preserves the user's original representation.

OpenAI GPT native aliases use Codex's freeform apply-patch tool. Other model families set `apply_patch_tool_type` to `null`, preventing Codex from injecting a freeform/custom patch tool that their ZenMux Responses adapters may reject.

OpenAI GPT native aliases retain Codex's `text_and_image` Web Search catalog metadata. Other model families omit `web_search_tool_type` and set `supports_search_tool` to `false`. Root configuration disables the native Responses Web Search tool for the provider as described below.

Codex currently defaults an omitted per-model Web Search type to `text` and offers no per-model disabled variant. Installation therefore sets root-level `web_search = "disabled"` so the complete cross-provider Responses catalog remains callable. Uninstall restores the original setting as part of exact configuration restoration.

The first installation records the exact `config.toml` path, whether the file existed, and its exact contents. Reinstallation refreshes the model catalog without replacing that original restore point. Install and uninstall reject restore state associated with a different Codex config path. `uninstall` restores the original configuration and removes the generated catalog while leaving OAuth credentials intact. If the current configuration no longer matches the installed digest, uninstall requires `--force`; forced restore first copies the current file to `config.toml.zenmux-uninstall.bak`.

## Verification

Automated tests cover PKCE derivation, authorization parameters, token rotation normalization, safe OAuth errors, replacement of API-key provider configuration, preservation of unrelated tables, and installer idempotency. Plugin validation and npm pack inspection are required before release.

Local end-to-end verification uses an ignored `.dev/` environment. It isolates `CODEX_HOME` and OAuth client state, sends authorization to production `https://zenmux.ai`, keeps model traffic on the production Responses-compatible API, and launches Codex with the same environment inherited by `auth.command`. The test client remains a dynamically registered native public client with no client secret.

Command-backed custom providers cause Codex to query their `/models` endpoint using the Codex catalog schema, which differs from the standard OpenAI `{ data: [...] }` response returned by ZenMux. The isolated environment therefore copies the selected model's installed Codex metadata into a one-model local catalog, changes its slug to the ZenMux model ID, and disables first-party-only Responses Lite and hosted multi-agent transport flags.
