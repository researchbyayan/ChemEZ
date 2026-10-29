const {test}=require('node:test');const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {selectUpdate,newer,createReleaseInfo}=require('./release-info.cjs');
const release=(name,url)=>({tag_name:'v1.2.0',draft:false,prerelease:false,assets:[{name,size:123,browser_download_url:url||'https://github.com/researchbyayan/ChemEZ/releases/download/v1.2.0/'+name}]});
test('stable updates select exact platform assets and compare numeric versions',()=>{
 assert.equal(newer('1.10.0','1.9.0'),true);
 assert.equal(selectUpdate(release('ChemEZ-1.2.0-mac-arm64.dmg'),'1.0.0','darwin','arm64').status,'available');
 assert.equal(selectUpdate(release('ChemEZ-1.2.0-win-x64.exe'),'1.0.0','win32','x64').status,'available');
 assert.equal(selectUpdate(release('ignored'),'1.2.0','darwin','x64').status,'current');
 assert.throws(()=>selectUpdate(release('ChemEZ-1.2.0-mac-x64.dmg','https://evil.invalid/file'),'1.0.0','darwin','x64'));
 assert.throws(()=>selectUpdate(release('ChemEZ-1.2.0-mac-arm64.dmg'),'1.0.0','darwin','x64'));
 assert.throws(()=>selectUpdate({...release('a'),prerelease:true},'1.0.0','darwin','x64'));
 assert.throws(()=>newer('2.0.0-beta','1.0.0'));
});
test('offline licenses are allowlisted and Rosetta recommends native architecture',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'ChemEZ credits with spaces '));
 try{
 await mkdir(path.join(root,'dist/release/licenses'),{recursive:true});await writeFile(path.join(root,'dist/release/credits.json'),JSON.stringify({entries:[{id:'mit',url:'https://github.com/researchbyayan/ChemEZ',licenseAvailable:true}]}));await writeFile(path.join(root,'dist/release/licenses/mit.txt'),'MIT license');
 const api=createReleaseInfo({root,app:{getVersion:()=> '1.0.0',runningUnderARM64Translation:true},fetchImpl:async()=>{throw new Error('offline');}});
 assert.equal(await api.license('mit'),'MIT license');await assert.rejects(()=>api.license('../../credentials'));await assert.rejects(()=>api.license('unlisted'));await assert.rejects(()=>api.updates());
 assert.equal((await api.appInfo()).build,'development');if(process.platform==='darwin')assert.equal((await api.appInfo()).nativeArch,'arm64');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('development About uses the project version instead of the Electron runtime version',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'ChemEZ version '));
 try{await writeFile(path.join(root,'package.json'),JSON.stringify({version:'1.2.3'}));const api=createReleaseInfo({root,app:{getVersion:()=> '45.0.0',isPackaged:false}});assert.equal((await api.appInfo()).version,'1.2.3');}finally{await rm(root,{recursive:true,force:true});}
});
