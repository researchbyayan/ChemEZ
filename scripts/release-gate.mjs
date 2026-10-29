import {readFile,writeFile,readdir,stat,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {root} from './python-path.mjs';
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const failures=[];const mode=process.argv[2];
const result={schemaVersion:1,platform:process.platform,arch:process.arch,version:pkg.version,checks:[],artifacts:[]};
function check(ok,message){result.checks.push({ok:!!ok,message});if(!ok)failures.push(message);}
function run(exe,args){const r=spawnSync(exe,args,{encoding:'utf8'});return r.status===0;}
if(mode==='--preflight'){
 for(const name of ['CSC_LINK','CSC_KEY_PASSWORD',...(process.platform==='darwin'?['APPLE_ID','APPLE_APP_SPECIFIC_PASSWORD','APPLE_TEAM_ID']:[])])check(!!process.env[name],'Signing input available: '+name);
 const reference=process.env.GITHUB_REF_NAME;
 if(reference)check(reference==='v'+pkg.version,'Release tag matches package version.');
 const dirty=spawnSync('git',['status','--porcelain','--untracked-files=normal'],{cwd:root,encoding:'utf8'});check(dirty.status===0&&!dirty.stdout.trim(),'Public candidates require a clean committed checkpoint.');
}
if(mode==='--readiness'){
 const readiness=JSON.parse(await readFile(path.resolve(root,process.env.CHEMEZ_READINESS_FILE||'release-config/readiness.json'),'utf8'));
 const head=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim();
 check(readiness.sourceCommit===head,'Readiness evidence is tied to the exact release commit.');
 for(const [name,value] of Object.entries(readiness.approvals)){const evidence=readiness.evidence[name];check(value===true&&evidence&&typeof evidence.path==='string'&&/^[a-f0-9]{64}$/.test(evidence.sha256||''),'Documented readiness approval: '+name);if(evidence?.path){try{const location=path.resolve(root,evidence.path);if(!location.startsWith(root+path.sep))throw new Error('Evidence must be inside the workspace.');const data=await readFile(location);check(createHash('sha256').update(data).digest('hex')===evidence.sha256,'Readiness evidence checksum: '+name);}catch{check(false,'Readiness evidence file exists: '+name);}}}
}
if(mode==='--artifacts'){
 const directory=path.resolve(root,process.env.CHEMEZ_RELEASE_DIR||'release');
 const entries=await readdir(directory);const ext=process.platform==='darwin'?'.dmg':'.exe';
 const installers=entries.filter(name=>name===`ChemEZ-${pkg.version}-${process.platform==='darwin'?'mac':'win'}-${process.arch}${ext}`);
 check(installers.length===1,'Exactly one correctly named installer for this native target.');
 async function bytes(dir){let total=0;for(const e of await readdir(dir,{withFileTypes:true})){const f=path.join(dir,e.name);total+=e.isDirectory()?await bytes(f):e.isSymbolicLink()?0:(await stat(f)).size;}return total;}
 for(const name of installers){const file=path.join(directory,name),data=await readFile(file);check(data.length<=250000000,'Installer ≤250,000,000 bytes: '+name);result.artifacts.push({name,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});}
 const appDir=process.platform==='darwin'?path.join(directory,process.arch==='arm64'?'mac-arm64':'mac','ChemEZ.app'):path.join(directory,'win-unpacked');
 const resources=process.platform==='darwin'?path.join(appDir,'Contents/Resources'):path.join(appDir,'resources');
 const credits=JSON.parse(await readFile(path.join(root,'dist/release/credits.json'),'utf8'));
 check(!credits.missingLicenseFiles.length,'All required offline license texts collected.');
 const build=JSON.parse(await readFile(path.join(root,'dist/release/build.json'),'utf8'));
 check(build.platform===process.platform&&build.arch===process.arch,'Build metadata matches native target.');result.build=build;
 check(!build.dirty,'Public candidate build metadata is clean.');
 if(process.platform==='darwin'){
  const signature=spawnSync('codesign',['-d','--verbose=4',appDir],{encoding:'utf8'});check(signature.status===0&&signature.stderr.includes('Authority=Developer ID Application:')&&(!process.env.APPLE_TEAM_ID||signature.stderr.includes('TeamIdentifier='+process.env.APPLE_TEAM_ID)),'Expected Developer ID Application signature.');
  check(run('codesign',['--verify','--deep','--strict',appDir]),'Nested macOS signatures verify.');
  check(run('xcrun',['stapler','validate',appDir]),'Notarization ticket is stapled to the app.');
  for(const name of installers)check(run('xcrun',['stapler','validate',path.join(directory,name)]),'Notarization ticket is stapled to '+name);
  check(run('spctl',['--assess','--type','execute',appDir]),'Gatekeeper assessment passes.');
 }else if(process.platform==='win32'){
  for(const file of [path.join(appDir,'ChemEZ.exe'),path.join(resources,'backend/chemez-backend.exe'),...installers.map(n=>path.join(directory,n))]){
   const script=`$s=Get-AuthenticodeSignature -LiteralPath '${file.replaceAll("'","''")}'; if($s.Status -ne 'Valid'){exit 1}`;
   check(run('powershell',['-NoProfile','-NonInteractive','-Command',script]),'Authenticode signature verifies: '+path.basename(file));
  }
 }
 result.installedBytes=await bytes(appDir);result.components={backend:await bytes(path.join(resources,'backend')),resources:await bytes(resources)};
}
if(!['--preflight','--readiness','--artifacts'].includes(mode))throw new Error('Choose --preflight, --readiness or --artifacts.');
await mkdir(path.join(root,'test-results/release'),{recursive:true});await writeFile(path.join(root,'test-results/release',mode.slice(2)+'.json'),JSON.stringify(result,null,2));
for(const failure of failures)console.error(failure);
console.log(`${result.checks.filter(c=>c.ok).length}/${result.checks.length} release checks passed.`);if(failures.length)process.exitCode=1;
