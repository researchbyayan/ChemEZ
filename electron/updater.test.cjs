const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {createUpdater}=require('./updater.cjs');
test('offers an update at most once a week',{skip:process.platform!=='darwin'},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'chemez-update-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const sent=[];let now=Date.now();t.mock.method(Date,'now',()=>now);
 const app={isPackaged:true,getPath:()=>dir};
 const make=()=>createUpdater({app,shell:{},releaseInfo:{updates:async()=>({status:'available',version:'0.1.3',url:'https://github.com/x/y.dmg',size:1})},send:v=>sent.push(v)});
 // Each check runs on a fresh updater, as after a relaunch.
 const check=()=>make().check();
 await check();assert.deepEqual(sent,[{state:'available',version:'0.1.3'}]);
 now+=3*24*3600e3;await check();assert.equal(sent.length,1);
 now+=5*24*3600e3;await check();assert.equal(sent.length,2);
});
