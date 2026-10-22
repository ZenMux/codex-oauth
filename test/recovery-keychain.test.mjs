import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('macOS recovery stays in a separate Keychain service, not a plaintext journal',{skip:process.platform!=='darwin'},()=>{
 const dir=mkdtempSync(join(tmpdir(),'oauth-keychain-mock-'));
 try{
  const script=`
    import assert from 'node:assert/strict';
    import cp from 'node:child_process';
    import {promisify} from 'node:util';
    import {syncBuiltinESMExports} from 'node:module';
    import {readdir} from 'node:fs/promises';
    const records=new Map();
    cp.execFile = () => { throw new Error('unmocked call'); };
    cp.execFile[promisify.custom]=async(command,args)=>{
      assert.equal(command,'security');
      const key=args[args.indexOf('-s')+1]+':'+args[args.indexOf('-a')+1];
      if(args[0]==='add-generic-password'){records.set(key,args[args.indexOf('-w')+1]);return {stdout:'',stderr:''};}
      if(args[0]==='delete-generic-password'){records.delete(key);return {stdout:'',stderr:''};}
      if(!records.has(key))throw Object.assign(new Error('missing'),{code:44});
      return {stdout:records.get(key),stderr:''};
    };
    syncBuiltinESMExports();
    const s=await import(${JSON.stringify(new URL('../src/storage.mjs',import.meta.url).href)});
    await s.writeCredentials({refresh_token:'test-main'});
    await s.writeRefreshRecovery({phase:'received',credentials:{refresh_token:'test-recovery'}});
    assert.equal((await s.readCredentials()).refresh_token,'test-main');
    assert.equal((await s.readRefreshRecovery()).credentials.refresh_token,'test-recovery');
    assert.equal(records.size,2);
    assert.deepEqual(await readdir(process.env.ZENMUX_OAUTH_STATE_DIR),[]);
    await s.deleteRefreshRecovery();
    assert.equal(records.size,1);
  `;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,ZENMUX_OAUTH_STORAGE:'keychain',ZENMUX_OAUTH_STATE_DIR:dir,ZENMUX_OAUTH_ORIGIN:'https://zenmux.ai'}});
  assert.equal(result.status,0,result.stderr);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
