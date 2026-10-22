import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';

test('eight independent helpers consume the same refresh token only once',{timeout:15000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'oauth-concurrency-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(join(dir,'credentials.json'),JSON.stringify({'https://zenmux.ai':{access_token:'fake-A',refresh_token:'fake-refresh-A',expires_at:Date.now()-1}}),{mode:0o600});
 let requests=0;
 const server=createServer(async(req,res)=>{
  for await(const chunk of req)void chunk;
  requests++;
  await new Promise(resolve=>setTimeout(resolve,200));
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({access_token:'fake-B',refresh_token:'fake-refresh-B',expires_in:7200}));
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>{server.closeAllConnections();server.close();});
 const url=`http://127.0.0.1:${server.address().port}`;
 const source=`const {getAccessToken}=await import(${JSON.stringify(new URL('../src/oauth.mjs',import.meta.url).href)});const token=await getAccessToken({fetchImpl:(_url,options)=>fetch(${JSON.stringify(url)},options)});if(token!=='fake-B')throw new Error('wrong token');`;
 await Promise.all(Array.from({length:8},async()=>{
  const child=spawn(process.execPath,['--input-type=module','-e',source],{env:{...process.env,ZENMUX_OAUTH_STORAGE:'file',ZENMUX_OAUTH_STATE_DIR:dir,ZENMUX_OAUTH_ORIGIN:'https://zenmux.ai',ZENMUX_OAUTH_CLIENT_ID:'test-client'},stdio:['ignore','ignore','pipe']});
  t.after(()=>{if(child.exitCode===null)child.kill();});
  let err='';child.stderr.on('data',c=>err+=c);
  const [code,signal]=await once(child,'close');assert.equal(signal,null);assert.equal(code,0,err);
 }));
 assert.equal(requests,1);
 assert.equal(JSON.parse(await readFile(join(dir,'credentials.json'),'utf8'))['https://zenmux.ai'].refresh_token,'fake-refresh-B');
 await assert.rejects(stat(join(dir,'refresh.lock')),{code:'ENOENT'});
});
