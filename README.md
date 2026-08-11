# codex-oauth

Use [ZenMux](https://zenmux.ai) models in Codex with OAuth 2.0 Authorization Code + PKCE. The package configures ZenMux as a custom Responses provider and supplies short-lived Bearer tokens through Codex's command-backed provider authentication.

## Install

Install the CLI globally:

```bash
npm install -g @zenmux/codex-oauth
```

Configure Codex and sign in:

```bash
zenmux-codex-auth install
zenmux-codex-auth login
```

Restart Codex after installation. The installer selects the `zenmux` provider but leaves your existing model name unchanged. When a configuration already exists, its previous contents are preserved in `config.toml.bak`.

`zenmux-codex-auth install` is the Codex configuration step, not the npm installation step. It downloads the current production models that explicitly support the Responses protocol, writes a private Codex catalog, configures the `agents` namespace for v2 multi-agent models, and records the original configuration for a later restore. OpenAI GPT-series entries use ZenMux's native aliases (for example `gpt-5.6-sol`) and opt into Codex multi-agent v2; other providers keep their full ZenMux slugs and follow Codex's default multi-agent behavior.

When migrating an existing Codex configuration, install removes the legacy `[features]` entry `multi_agent_v2 = true` before creating `[features.multi_agent_v2]`. TOML does not allow the same key to be both a Boolean and a settings table.

The installer sets Codex's native Responses `web_search` mode to `disabled`. Current Codex cannot disable that OpenAI-native tool per catalog entry, while protocol-converted Responses models such as Claude reject it. This keeps the full production Responses catalog usable across providers. Uninstall restores the user's previous Web Search setting together with the rest of `config.toml`.

## Commands

```text
zenmux-codex-auth install  Configure the ZenMux provider in ~/.codex/config.toml
zenmux-codex-auth uninstall [--force]
                           Restore the configuration saved before install
zenmux-codex-auth login    Open the ZenMux PKCE authorization flow
zenmux-codex-auth token    Return a valid token to Codex auth.command
zenmux-codex-auth status   Show non-sensitive authentication state
zenmux-codex-auth logout   Remove OAuth credentials
```

Do not run or capture `token` for debugging. It is intended for Codex and prints a live Bearer token to stdout.

## How it works

- The first login automatically registers a native public OAuth client.
- Installation downloads the production Responses model list and makes it available in Codex `/model` through `model_catalog_json`.
- Authorization uses PKCE with `S256` and a temporary loopback callback on `127.0.0.1`.
- The package requests `inference:invoke offline_access` by default.
- Access tokens are refreshed before expiry; rotated refresh tokens are saved atomically.
- macOS credentials are stored in Keychain. Other platforms currently use `~/.config/zenmux/codex-oauth/credentials.json` with mode `0600`.
- When macOS has an HTTPS system proxy, the CLI automatically starts its network process with that proxy; no machine-specific proxy address is stored in configuration.
- Tokens are never stored in `config.toml`.

The generated provider configuration uses the supported Codex shape:

```toml
model_provider = "zenmux"

[model_providers.zenmux]
name = "ZenMux"
base_url = "https://zenmux.ai/api/v1"
wire_api = "responses"

[model_providers.zenmux.auth]
command = "/absolute/path/to/zenmux-codex-auth"
args = ["token"]
refresh_interval_ms = 300000
timeout_ms = 15000
```

## Development configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ZENMUX_OAUTH_ORIGIN` | `https://zenmux.ai` | OAuth authorization-server origin |
| `ZENMUX_API_BASE_URL` | `https://zenmux.ai/api/v1` | Responses-compatible API base URL |
| `ZENMUX_OAUTH_CLIENT_ID` | automatic registration | Reuse a registered native public client |
| `ZENMUX_OAUTH_SCOPES` | `inference:invoke offline_access` | OAuth scopes requested at login |
| `ZENMUX_MODELS_CATALOG_URL` | production Responses-filtered model endpoint | Override the model source for development |
| `CODEX_HOME` | `~/.codex` | Codex configuration directory |
| `ZENMUX_OAUTH_STATE_DIR` | `~/.config/zenmux/codex-oauth` | Client cache, fallback credentials, and refresh lock |
| `ZENMUX_OAUTH_STORAGE=file` | unset | Force private-file storage instead of macOS Keychain |
| `ZENMUX_OAUTH_NO_BROWSER=1` | unset | Print the authorization URL without opening a browser |

Run validation locally:

```bash
npm test
npm pack --dry-run
```

## Uninstall

Restore the Codex configuration captured by the first installation before removing the npm package:

```bash
zenmux-codex-auth uninstall
npm uninstall -g @zenmux/codex-oauth
```

OAuth credentials are intentionally preserved by `uninstall`; remove them separately with `zenmux-codex-auth logout`. If `config.toml` changed after installation, uninstall stops instead of discarding those changes. After review, `uninstall --force` first saves the current file as `config.toml.zenmux-uninstall.bak`, then restores the original.

### Isolated production OAuth test environment

The development commands keep Codex configuration and OAuth client state under `.dev/`, separate from the normal `~/.codex` environment. OAuth authorization and model requests both use production ZenMux endpoints while the local Codex configuration remains disposable.

```bash
npm run dev:setup
npm run dev:login
npm run dev:codex
```

The default test model is `openai/gpt-5.6-sol`. The setup command copies its metadata from the installed Codex model cache, changes the slug to the ZenMux model ID, and disables the first-party Responses Lite transport for the custom provider. Override the model only when matching Codex metadata is available locally: `ZENMUX_TEST_MODEL=<provider/model> npm run dev:setup`.

## Security

This package executes as the current user and modifies the user-level Codex configuration only when `install` is invoked. Review the source before installation. The loopback listener accepts only the expected callback path and validates `state` before exchanging a code.

## License

MIT
