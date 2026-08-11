import { installCodexConfig } from './codex-config.mjs';
import { getAccessToken, getStatus, login, logout } from './oauth.mjs';

const help = `ZenMux OAuth for Codex

Usage:
  zenmux-codex-auth install  Configure the ZenMux model provider in Codex
  zenmux-codex-auth login    Sign in to ZenMux with OAuth 2.0 PKCE
  zenmux-codex-auth token    Print a valid access token for Codex auth.command
  zenmux-codex-auth status   Show authentication status without revealing tokens
  zenmux-codex-auth logout   Remove saved OAuth credentials
  zenmux-codex-auth help     Show this help
`;

export async function runCli(args) {
  const command = args[0] || 'help';
  if (command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(help);
    return;
  }
  if (command === 'install') {
    const path = await installCodexConfig();
    process.stdout.write(`Configured ZenMux in ${path}\n`);
    process.stdout.write('Next: run `zenmux-codex-auth login`, then restart Codex.\n');
    return;
  }
  if (command === 'login') {
    const credentials = await login();
    process.stdout.write(`Signed in to ZenMux. Access token expires at ${new Date(credentials.expires_at).toISOString()}.\n`);
    return;
  }
  if (command === 'token') {
    process.stdout.write(`${await getAccessToken()}\n`);
    return;
  }
  if (command === 'status') {
    const status = await getStatus();
    process.stdout.write(`${status.signedIn ? 'Signed in' : 'Not signed in'}\n`);
    process.stdout.write(`Provider: ${status.provider}\n`);
    process.stdout.write(`Storage: ${status.storage}\n`);
    if (status.expiresAt) process.stdout.write(`Access token expires: ${status.expiresAt.toISOString()}\n`);
    if (status.scopes) process.stdout.write(`Scopes: ${status.scopes}\n`);
    return;
  }
  if (command === 'logout') {
    await logout();
    process.stdout.write('Signed out of ZenMux.\n');
    return;
  }
  throw new Error(`Unknown command: ${command}\n\n${help}`);
}
