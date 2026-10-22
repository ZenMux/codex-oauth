import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
for(const scenario of ['success','lost-response','partial-response','body-abort','invalid-grant','missing-refresh','save-fails','save-transient','journal-fails','both-fail','pending-fails']){
 test(`refresh safety: ${scenario}`,{timeout:10000},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'oauth-recovery-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const child=spawn(process.execPath,[new URL('../fixtures/refresh-scenario.mjs',import.meta.url).pathname,scenario],{
   env:{...process.env,ZENMUX_OAUTH_STORAGE:'file',ZENMUX_OAUTH_STATE_DIR:dir,ZENMUX_OAUTH_ORIGIN:'https://zenmux.ai',ZENMUX_OAUTH_CLIENT_ID:'synthetic-client'},stdio:['ignore','pipe','pipe'],
  });
  t.after(()=>{if(child.exitCode===null)child.kill();});
  let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);
  const [code,signal]=await once(child,'close');
  assert.equal(signal,null);assert.equal(code,0,err);
  assert.equal(out.trim(),'scenario passed');
  assert.doesNotMatch(err,/synthetic-access|synthetic-refresh|synthetic-secret-detail/);
  if(['lost-response','partial-response','body-abort','invalid-grant','missing-refresh','both-fail'].includes(scenario))assert.match(err,/unsafe_retry_blocked/);
  if(scenario==='save-fails')assert.match(err,/credentials_recovered/);
 });
}
