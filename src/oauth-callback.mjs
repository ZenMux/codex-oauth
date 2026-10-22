// Parse locally only: never request a pasted URL or print its authorization code.
export function parseOAuthCallback(value, redirectUri, expectedState) {
  if (typeof value !== 'string' || value.length > 8192) throw new Error('Invalid callback URL');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('Paste the complete callback URL from the browser address bar'); }
  const expected = new URL(redirectUri);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.username || url.password || url.hash) {
    throw new Error('Callback URL does not match this login session');
  }
  if (url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== expectedState) {
    throw new Error('Callback state does not match this login session');
  }
  const codes = url.searchParams.getAll('code');
  const errors = url.searchParams.getAll('error');
  if (errors.length === 1 && errors[0] && codes.length === 0) {
    // error_description can contain arbitrary server text; never echo it.
    const error = /^[a-z_]{1,64}$/.test(errors[0]) ? errors[0] : 'authorization_failed';
    return { error };
  }
  if (errors.length || codes.length !== 1 || !codes[0]) throw new Error('Callback must contain exactly one authorization code');
  return { code: codes[0] };
}
