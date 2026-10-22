import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOAuthCallback } from '../src/oauth-callback.mjs';
const redirect='http://127.0.0.1:45678/callback';
const state='test-state';
test('accepts only the exact callback session and decodes the code',()=>{
 assert.deepEqual(parseOAuthCallback(` ${redirect}?code=a%2Bb&state=${state} `,redirect,state),{code:'a+b'});
});
for(const value of [
 `https://example.com/callback?code=secret-code&state=${state}`,
 `http://127.0.0.1:45679/callback?code=secret-code&state=${state}`,
 `${redirect}?code=secret-code&state=other`,
 `${redirect}?code=secret-code&state=${state}&state=${state}`,
 `${redirect}?code=secret-code&code=other&state=${state}`,
 `${redirect}?code=secret-code&error=access_denied&state=${state}`,
 `${redirect}?state=${state}`,
 `${redirect}?code=secret-code&state=${state}#fragment`,
 `http://user:pass@127.0.0.1:45678/callback?code=secret-code&state=${state}`,
 'not-a-url',
 'x'.repeat(8193),
]){
 test('rejects malformed/mismatched callback without echoing sensitive input',()=>{
  assert.throws(()=>parseOAuthCallback(value,redirect,state),error=>!error.message.includes('secret-code')&&!error.message.includes('user:pass'));
 });
}
test('does not echo arbitrary OAuth error descriptions',()=>{
 assert.deepEqual(parseOAuthCallback(`${redirect}?state=${state}&error=access_denied&error_description=secret-code`,redirect,state),{error:'access_denied'});
});
