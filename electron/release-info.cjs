const fs=require('node:fs/promises');
const path=require('node:path');
const ROOT='https://api.github.com/repos/researchbyayan/ChemEZ/releases/latest';
function parseVersion(v){const match=/^v?(\d+)\.(\d+)\.(\d+)$/.exec(v);if(!match)throw new Error('Invalid stable release version.');return match.slice(1).map(Number);}
function newer(a,b){const x=parseVersion(a),y=parseVersion(b);for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i];}return false;}
function selectUpdate(release,current,platform,arch){
 if(release.draft||release.prerelease)throw new Error('No stable public release is available.');
 if(!newer(release.tag_name,current))return {status:'current',version:current};
 const os=platform==='darwin'?'mac':platform==='win32'?'win':null;
 if(!os||!['x64','arm64'].includes(arch))throw new Error('No supported installer for this platform.');
 const ext=platform==='darwin'?'dmg':'exe',version=release.tag_name.replace(/^v/,'');
 const expected=`ChemEZ-${version}-${os}-${arch}.${ext}`;
 const asset=release.assets?.find(a=>a.name===expected);
 if(!asset||!Number.isSafeInteger(asset.size)||asset.size<=0||asset.size>250000000)throw new Error('The matching installer is unavailable or exceeds the release size limit.');
 const url=new URL(asset.browser_download_url);
 if(url.origin!=='https://github.com'||url.pathname!==`/researchbyayan/ChemEZ/releases/download/${release.tag_name}/${expected}`||url.search||url.hash)throw new Error('Unexpected installer URL.');
 return {status:'available',version,url:url.href,size:asset.size};
}
function createReleaseInfo({app,root,fetchImpl=fetch}){
 const directory=path.join(root,'dist/release');
 async function credits(){return JSON.parse(await fs.readFile(path.join(directory,'credits.json'),'utf8'));}
 return {
  async appInfo(){let build={};try{build=JSON.parse(await fs.readFile(path.join(directory,'build.json'),'utf8'));}catch{}
   let version=app.getVersion();if(app.isPackaged===false){try{version=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;}catch{}}
   return {version,platform:process.platform,arch:process.arch,nativeArch:process.platform==='darwin'&&app.runningUnderARM64Translation?'arm64':process.arch,build:build.commit||'development',dirty:!!build.dirty,source:'https://github.com/researchbyayan/ChemEZ'};},
  credits,
  async license(id){if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,250}$/.test(id))throw new Error('Invalid license identifier.');const item=(await credits()).entries.find(e=>e.id===id);if(!item?.licenseAvailable)throw new Error('License is not available.');return fs.readFile(path.join(directory,'licenses',id+'.txt'),'utf8');},
  async source(id){const item=(await credits()).entries.find(e=>e.id===id);if(!item)throw new Error('Unknown attribution.');const url=new URL(item.url);if(url.protocol!=='https:'||url.username||url.password)throw new Error('Unsafe source URL.');return url.href;},
  async updates(){const info=await this.appInfo();const response=await fetchImpl(ROOT,{headers:{Accept:'application/vnd.github+json','User-Agent':'ChemEZ/'+info.version},signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('Update check unavailable. Try again later.');return selectUpdate(await response.json(),info.version,process.platform,info.nativeArch);}
 };
}
module.exports={createReleaseInfo,selectUpdate,newer};
