import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
const scenario=process.argv[2];
const dir=process.env.ZENMUX_OAUTH_STATE_DIR;
const realRename=fs.rename;
let inject=false, failCount=0;
fs.rename=async(...args)=>{
  const main=args[1]===join(dir,'credentials.json');
  const journal=args[1]===join(dir,'refresh-recovery.json');
  if(inject && ((main && ['save-fails','save-transient','both-fail'].includes(scenario)) || (journal && ['journal-fails','both-fail','pending-fails'].includes(scenario)))){
    if(scenario!=='save-transient' || failCount++<1) throw Object.assign(new Error('injected storage failure'),{code:'EACCES'});
  }
  return realRename(...args);
};
syncBuiltinESMExports();
const store=await import('../src/storage.mjs');
const oauth=await import('../src/oauth.mjs');
const before={access_token:'synthetic-access-A',refresh_token:'synthetic-refresh-A',expires_at:Date.now()-1000};
await store.writeCredentials(before);
let calls=0;
const fakeFetch=async (_url,options)=>{
  calls++;
  if(scenario==='pending-fails') assert.fail('network must not run before journal is durable');
  if(calls>1) assert.fail('consumed refresh token must not be sent again');
  if(scenario==='lost-response') throw new TypeError('connection reset with synthetic-secret-detail');
  if(scenario==='partial-response') return new Response('{"access_token":', {status:200});
  if(scenario==='invalid-grant') return new Response(JSON.stringify({error:'invalid_grant',error_description:'synthetic-secret-detail'}),{status:400});
  if(scenario==='body-abort'){
    options.signal.throwIfAborted();
    return {status:200,ok:true,headers:new Headers(),text:async()=>{throw new DOMException('aborted','TimeoutError');}};
  }
  if(['save-fails','save-transient','journal-fails','both-fail'].includes(scenario)) inject=true;
  return new Response(JSON.stringify({access_token:'synthetic-access-B',...(scenario==='missing-refresh'?{}:{refresh_token:'synthetic-refresh-B'}),expires_in:7200}),{status:200});
};
if(scenario==='pending-fails')inject=true;
let error;
try{await oauth.getAccessToken({fetchImpl:fakeFetch});}catch(e){error=e;}
if(['lost-response','partial-response','invalid-grant','body-abort','missing-refresh','both-fail'].includes(scenario)){
  assert.ok(error);assert.doesNotMatch(error.message,/synthetic-secret/);
  inject=false;
  await assert.rejects(oauth.getAccessToken({fetchImpl:fakeFetch}),/refusing to reuse/);
  assert.equal((await store.readCredentials()).refresh_token,before.refresh_token);
  // Successful reauthorization uses a new token: an old journal must not replay.
  await store.writeCredentials({...before,refresh_token:'synthetic-new-login',access_token:'synthetic-new-access',expires_at:Date.now()+7200000});
  assert.equal(await oauth.getAccessToken({fetchImpl:fakeFetch}),'synthetic-new-access');
}else if(scenario==='save-fails'){
  assert.match(error.message,/safely journaled/);
  assert.equal((await store.readRefreshRecovery()).phase,'received');
  assert.equal((await store.readCredentials()).refresh_token,before.refresh_token);
  inject=false;
  assert.equal(await oauth.getAccessToken({fetchImpl:fakeFetch}),'synthetic-access-B');
  assert.equal(calls,1);
}else if(scenario==='pending-fails'){
  assert.ok(error);assert.equal(calls,0);
}else{
  assert.ifError(error);
  assert.equal((await store.readCredentials()).refresh_token,'synthetic-refresh-B');
  assert.equal(await oauth.getAccessToken({fetchImpl:fakeFetch}),'synthetic-access-B');
}
if(scenario!=='pending-fails')assert.equal(calls,1);
for(const file of ['credentials.json','refresh-recovery.json']){
 const stat=await fs.stat(join(dir,file)).catch(()=>null);if(stat)assert.equal(stat.mode&0o777,0o600);
}
assert.equal((await fs.readdir(dir)).filter(x=>x.endsWith('.tmp')).length,0);
console.log('scenario passed');
