# Headless callback input (0.2.11)

## Scope
Allow a browser on another machine to complete the existing loopback PKCE login
by pasting its final callback URL into the waiting helper. No new OAuth protocol,
callback relay, remote URL fetching, token storage format, or refresh behavior.

## Design
`login --no-browser` suppresses browser launch; normal login also accepts stdin.
Readline is created only after the loopback listener is ready. HTTP and stdin
share a parser and a settled guard. Validate exact URL origin/path, absence of
userinfo/fragment, exactly one matching state, and either one nonempty code or
one OAuth error (not both). Duplicate completion never exchanges a code twice.
Wrong input prints a fixed diagnostic and permits retry. Arbitrary URL values
and upstream error descriptions are not logged. Token exchange uses the original
redirect URI and in-memory PKCE verifier, never values supplied by the pasted URL.

Completion closes readline, pauses stdin, clears the authorization timer and
bounds HTTP shutdown. EOF disables manual entry only; matching OAuth denial and
five-minute timeout terminate with errors. OS SIGINT remains normal cancellation.
A TTY may echo the user's paste: documentation treats the callback as sensitive.

## Verification
Parser tests cover wrong origin/port/state, duplicate state/code, mixed error/code,
fragments, userinfo, oversized/malformed input, decoding and error redaction.
Subprocess tests cover stdin-only success with stdin left open, bad input then
success, duplicate completion, OAuth denial, automatic callback with stdin open,
and unchanged PKCE/redirect values. Existing login-exit and refresh-recovery suites
must remain green. All credentials and exchanges are synthetic.

## Release
Publish 0.2.11 and its matching Git tag. Update the Poolab helper only; leave actual
credentials/configuration untouched and let the user perform authorization.
