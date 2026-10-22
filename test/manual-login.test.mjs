import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';

for(const mode of ['paste','invalid-then-paste','duplicate','denied','automatic-with-open-stdin','race','timeout']){
 test(`login callback input: ${mode}`,{timeout:8000},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'manual-oauth-'));
  const script=`
    import {createHash} from 'node:crypto';
    if(${JSON.stringify(mode)}==='timeout'){const native=setTimeout;globalThis.setTimeout=(fn,ms,...args)=>native(fn,ms===300000?200:ms,...args);}
    let calls=0,summary;
    globalThis.fetch=async(_url,options)=>{
      calls++;const p=new URLSearchParams(options.body);
      if(p.get('code')!=='synthetic-code')throw new Error('wrong code');
      summary={calls,challenge:createHash('sha256').update(p.get('code_verifier')).digest('base64url'),redirect:p.get('redirect_uri')};
      return new Response(JSON.stringify({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:7200}));
    };
    const {runCli}=await import(${JSON.stringify(new URL('../src/cli.mjs',import.meta.url).href)});
    await runCli(['login']).catch(e=>{process.stderr.write(e.message+'\\n');process.exitCode=1;});
    process.stderr.write('RESULT '+JSON.stringify(summary||{calls})+'\\n');
  `;
  const child=spawn(process.execPath,['--input-type=module','-e',script],{env:{...process.env,SSH_CONNECTION:'synthetic-ssh',ZENMUX_OAUTH_STORAGE:'file',ZENMUX_OAUTH_STATE_DIR:dir,ZENMUX_OAUTH_CLIENT_ID:'synthetic-client',ZENMUX_OAUTH_ORIGIN:'https://zenmux.ai'},stdio:['pipe','pipe','pipe']});
  const closed=once(child,'close');let out='',err='';let deadline;
  child.stdout.on('data',c=>out+=c);
  t.after(async()=>{clearTimeout(deadline);if(child.exitCode===null&&child.signalCode===null)child.kill();await closed;await rm(dir,{recursive:true,force:true});});
  const authorize=await new Promise((resolve,reject)=>{
   child.stderr.on('data',c=>{err+=c;const match=err.match(/https:\/\/zenmux\.ai\/oauth\/authorize\?[^\s]+/);if(match&&err.includes('粘贴回调地址'))resolve(new URL(match[0]));});
   child.once('error',reject);child.once('exit',()=>reject(new Error('Exited before prompt')));
  });
  assert.match(err,/Open this URL/);assert.doesNotMatch(err,/Opened this URL/);
  const callback=new URL(authorize.searchParams.get('redirect_uri'));
  callback.searchParams.set('state',authorize.searchParams.get('state'));
  callback.searchParams.set(mode==='denied'?'error':'code',mode==='denied'?'access_denied':'synthetic-code');
  if(mode==='invalid-then-paste'){
   const bad=new URL(callback);bad.searchParams.set('state','wrong');
   child.stdin.write(bad.href+'\n');
   child.stdin.write('https://example.com/callback?code=do-not-fetch\n');
  }
  if(mode==='timeout'){
   // The child shortens only the five-minute authorization timer.
  }else if(mode==='race'){
   const response=new Promise(resolve=>{http.get(callback,{agent:false},res=>{assert.ok([200,409].includes(res.statusCode));res.resume();res.on('end',resolve);}).on('error',resolve);});
   child.stdin.write(callback.href+'\n');
   await response;
  }else if(mode==='automatic-with-open-stdin'){
   await new Promise((resolve,reject)=>{http.get(callback,{agent:false},res=>{assert.equal(res.statusCode,200);res.resume();res.on('end',resolve);}).on('error',reject);});
  }else{
   child.stdin.write(callback.href+'\n');
   if(mode==='duplicate')child.stdin.write(callback.href+'\n');
  }
  // Deliberately leave stdin open: success must still exit without Ctrl+C/EOF.
  const [code,signal]=await Promise.race([closed,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('login did not exit: '+out+err)),4000);})]);
  assert.equal(signal,null);assert.equal(code,['denied','timeout'].includes(mode)?1:0,err);
  const result=JSON.parse(err.match(/RESULT (.+)/)[1]);
  assert.equal(result.calls,['denied','timeout'].includes(mode)?0:1);
  assert.doesNotMatch(out+err,/synthetic-code|synthetic-access|synthetic-refresh|do-not-fetch/);
  if(!['denied','timeout'].includes(mode)){
   assert.equal(result.redirect,authorize.searchParams.get('redirect_uri'));
   assert.equal(result.challenge,authorize.searchParams.get('code_challenge'));
   assert.equal(JSON.parse(await readFile(join(dir,'credentials.json'),'utf8'))['https://zenmux.ai'].refresh_token,'synthetic-refresh');
  }
 });
}
