import {spawnSync} from 'node:child_process';import {_electron as electron} from '@playwright/test';
import {readFile,readdir,mkdtemp,mkdir,writeFile,access,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
const pkg=JSON.parse(await readFile('package.json','utf8')),root=process.cwd(),temporary=await mkdtemp(path.join(os.tmpdir(),'ChemEZ install QA ü '));
const ext=process.platform==='darwin'?'.dmg':'.exe';const file=(await readdir('release')).find(f=>f===`ChemEZ-${pkg.version}-${process.platform==='darwin'?'mac':'win'}-${process.arch}${ext}`);if(!file)throw new Error('Native installer missing.');
function run(exe,args,env=process.env){const result=spawnSync(exe,args,{env,encoding:'utf8',timeout:180000});if(result.status!==0)throw new Error('Installer check failed: '+path.basename(exe));return result.stdout;}
let device,instance;const report={platform:process.platform,arch:process.arch,installer:file,checks:[]};
try{
 if(process.platform==='darwin'){
  const plist=run('hdiutil',['attach','-readonly','-nobrowse','-plist',path.resolve('release',file)]);
  const parsedResult=spawnSync('plutil',['-convert','json','-o','-','-'],{input:plist,encoding:'utf8'});if(parsedResult.status!==0)throw new Error('Could not read DMG mount metadata.');
  const mounted=JSON.parse(parsedResult.stdout)['system-entities'].find(e=>e['mount-point']);if(!mounted)throw new Error('Installer did not mount.');device=mounted['dev-entry'];
  const source=path.join(mounted['mount-point'],'ChemEZ.app'),destination=path.join(temporary,'ChemEZ.app');
  run('ditto',[source,destination]);
  run(process.execPath,['scripts/smoke-about.mjs','--packaged'],{...process.env,CHEMEZ_ELECTRON_EXE:path.join(destination,'Contents/MacOS/ChemEZ'),CHEMEZ_PYTHON:'/no-python'});
  report.checks.push('DMG mounts read-only; copied app launches from a Unicode/space path using bundled chemistry.');
 }else if(process.platform==='win32'){
  if(process.env.CI!=='true')throw new Error('Windows install/upgrade/uninstall checks require a disposable CI machine.');
  const installed=path.join(temporary,'Installed app');run(path.resolve('release',file),['/S','/D='+installed]);
  const executable=path.join(installed,'ChemEZ.exe');await access(executable);
  const env={...process.env,CHEMEZ_SESSION_ONLY:'1',CHEMEZ_PYTHON:'Z:\\no-python.exe'};delete env.CHEMEZ_PROFILE;
  instance=await electron.launch({executablePath:executable,args:[],env,timeout:60000});const userData=await instance.evaluate(({app})=>app.getPath('userData'));await mkdir(userData,{recursive:true});const sentinel=path.join(userData,'release-upgrade-canary.txt');await writeFile(sentinel,'retain user data');await instance.close();instance=null;
  run(path.resolve('release',file),['/S','/D='+installed]);await access(sentinel);report.checks.push('Per-user installation and upgrade preserve application data.');
  run(process.execPath,['scripts/smoke-about.mjs','--packaged'],{...process.env,CHEMEZ_ELECTRON_EXE:executable,CHEMEZ_PYTHON:'Z:\\no-python.exe'});
  const uninstall=(await readdir(installed)).find(f=>/^uninstall.*\.exe$/i.test(f));if(!uninstall)throw new Error('Uninstaller missing.');run(path.join(installed,uninstall),['/S']);let removed=false;for(let i=0;i<60;i++){try{await access(executable);}catch{removed=true;break;}await new Promise(resolve=>setTimeout(resolve,500));}if(!removed)throw new Error('Uninstaller did not finish.');await access(sentinel);report.checks.push('Uninstall preserves user data.');
  run(path.resolve('release',file),['/S','/D='+installed]);await access(sentinel);report.checks.push('Reinstallation preserves user data.');
 }else throw new Error('Release installer checks target macOS and Windows only.');
}finally{await instance?.close().catch(()=>{});if(device)run('hdiutil',['detach',device]);await mkdir('test-results/release',{recursive:true});await writeFile('test-results/release/installer.json',JSON.stringify(report,null,2));await rm(temporary,{recursive:true,force:true});}
