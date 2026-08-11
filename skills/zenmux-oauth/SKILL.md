---
name: zenmux-oauth
description: Configure or troubleshoot ZenMux as a Codex custom model provider using OAuth 2.0 Authorization Code with PKCE. Use when the user wants to sign Codex in to ZenMux, replace a ZenMux API key with OAuth, refresh or revoke ZenMux credentials, or diagnose ZenMux model-provider authentication.
---

# ZenMux OAuth for Codex

Use the `zenmux-codex-auth` CLI bundled with `@zenmux/codex-oauth`.

## Setup

1. Install the CLI globally with `npm install -g @zenmux/codex-oauth`.
2. Run `zenmux-codex-auth install`. It downloads the current production models that explicitly support the Responses protocol, writes a private Codex model catalog, saves restore state for the existing Codex configuration, selects the ZenMux Responses provider, and configures command-backed authentication. OpenAI GPT entries opt into `multi_agent_version: "v2"`; other model families follow Codex's default multi-agent behavior.
3. Run `zenmux-codex-auth login` and complete authorization in the browser.
4. Restart Codex after changing `config.toml`.

Do not print, log, paste, or inspect the output of `zenmux-codex-auth token`. Codex invokes that command internally and uses its stdout as a Bearer token.

`install` configures Codex; it does not install the npm package and does not perform OAuth login. Re-run it to refresh the production Responses model catalog.

For cross-provider compatibility, install sets root-level `web_search = "disabled"`. Codex currently cannot disable its OpenAI-native Responses Web Search tool per model, and protocol-converted models such as Claude reject that tool. Uninstall restores the previous setting.

## Operations

- Check non-sensitive state with `zenmux-codex-auth status`.
- Repeat `zenmux-codex-auth login` to replace unusable or revoked credentials.
- Run `zenmux-codex-auth logout` to remove stored OAuth credentials.
- Run `zenmux-codex-auth uninstall` before uninstalling the npm package. It restores the Codex configuration captured by the first install and removes the generated model catalog, but deliberately preserves OAuth credentials.
- If Codex configuration changed after installation, normal uninstall refuses to overwrite it. Review the changes first; `zenmux-codex-auth uninstall --force` backs up the current file as `config.toml.zenmux-uninstall.bak` and then restores the original.
- On macOS, credentials are stored in Keychain. Other platforms use a private file with mode `0600`.

## Development overrides

Use `ZENMUX_OAUTH_ORIGIN`, `ZENMUX_API_BASE_URL`, `ZENMUX_MODELS_CATALOG_URL`, or `ZENMUX_OAUTH_CLIENT_ID` only for development or self-hosted environments. The production defaults require no environment variables.
