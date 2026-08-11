---
name: zenmux-oauth
description: Configure or troubleshoot ZenMux as a Codex custom model provider using OAuth 2.0 Authorization Code with PKCE. Use when the user wants to sign Codex in to ZenMux, replace a ZenMux API key with OAuth, refresh or revoke ZenMux credentials, or diagnose ZenMux model-provider authentication.
---

# ZenMux OAuth for Codex

Use the `zenmux-codex-auth` CLI bundled with `@zenmux/codex-oauth`.

## Setup

1. Install the CLI globally with `npm install -g @zenmux/codex-oauth`.
2. Run `zenmux-codex-auth install` to add the ZenMux Responses provider and command-backed authentication to the user-level Codex configuration.
3. Run `zenmux-codex-auth login` and complete authorization in the browser.
4. Restart Codex after changing `config.toml`.

Do not print, log, paste, or inspect the output of `zenmux-codex-auth token`. Codex invokes that command internally and uses its stdout as a Bearer token.

## Operations

- Check non-sensitive state with `zenmux-codex-auth status`.
- Repeat `zenmux-codex-auth login` to replace unusable or revoked credentials.
- Run `zenmux-codex-auth logout` to remove stored OAuth credentials.
- On macOS, credentials are stored in Keychain. Other platforms use a private file with mode `0600`.

## Development overrides

Use `ZENMUX_OAUTH_ORIGIN`, `ZENMUX_API_BASE_URL`, or `ZENMUX_OAUTH_CLIENT_ID` only for development or self-hosted environments. The production defaults require no environment variables.
