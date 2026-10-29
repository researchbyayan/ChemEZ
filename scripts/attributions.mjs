import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {root,python,runtimePython} from './python-path.mjs';
const registry=JSON.parse(await readFile(path.join(root,'release-config/attributions.json'),'utf8'));
const lock=JSON.parse(await readFile(path.join(root,'package-lock.json'),'utf8'));
const entries=[];const missing=[];
const output=path.join(root,'dist/release');await mkdir(path.join(output,'licenses'),{recursive:true});
async function append(entry,text){
 if(entry.url){try{const u=new URL(entry.url);if(u.protocol==='http:')u.protocol='https:';if(u.protocol!=='https:')throw new Error();entry={...entry,url:u.href};}catch{entry={...entry,url:'https://www.npmjs.com/package/'+encodeURIComponent(entry.name)};}}
 const id=entry.id.replace(/[^a-zA-Z0-9_-]/g,'-');if(entries.some(e=>e.id===id))throw new Error('Duplicate credit '+id);
 entries.push({...entry,id,licenseAvailable:!!text});
 if(text)await writeFile(path.join(output,'licenses',id+'.txt'),text);
}
for(const entry of registry.entries){
 const parts=[];for(const file of entry.licenseFiles||[]){try{parts.push(await readFile(path.join(root,file),'utf8'));}catch{missing.push(file);}}
 await append(entry,parts.join('\n\n'));
}
for(const [location,item] of Object.entries(lock.packages)){
 if(!location||item.dev)continue;
 const name=location.split('node_modules/').at(-1),directory=path.join(root,location);
 const metadata=JSON.parse(await readFile(path.join(directory,'package.json'),'utf8'));
 const source=typeof metadata.repository==='string'?metadata.repository:metadata.repository?.url;
 const url=(source||metadata.homepage||'https://www.npmjs.com/package/'+name).replace(/^git\+/, '').replace(/^git:\/\//,'https://').replace(/\.git$/,'');
 const files=(await readdir(directory)).filter(n=>/^(licen[cs]e|copying|notice)/i.test(n));
 const texts=[];for(const file of files){try{texts.push(await readFile(path.join(directory,file),'utf8'));}catch{}}
 if(!texts.length&&['rehype-katex','remark-math'].includes(name)){try{texts.push(await readFile(path.join(root,'licenses/remark-math-LICENSE.txt'),'utf8'));}catch{}}
 if(!texts.length)missing.push('npm:'+name);
 await append({id:'npm-'+location.replaceAll('node_modules/',''),name,version:item.version,url,group:'software',license:item.license||'See license text',note:'Bundled JavaScript dependency.'},texts.join('\n\n'));
}
const script=`import json,importlib.metadata as m,pathlib,sysconfig,sys
items=[]
for d in m.distributions():
 name=d.metadata['Name']; files=[]
 for f in d.files or []:
  p=str(f)
  if '.dist-info/' in p and (any(x in pathlib.Path(p).name.lower() for x in ('license','licence','copying','notice')) or '/licenses/' in p):
   try: files.append(d.locate_file(f).read_text(errors='replace'))
   except (OSError,UnicodeError): pass
 if name.lower() in ('pip','pytest','pytest-asyncio','pyinstaller-hooks-contrib','packaging','altgraph','macholib','iniconfig','pluggy','pygments'):continue
 url=d.metadata.get('Home-page','')
 for value in d.metadata.get_all('Project-URL') or []:
  if value.lower().startswith(('source,','repository,','homepage,')):url=value.split(',',1)[1].strip();break
 items.append(dict(name=name,version=d.version,url=url,license=d.metadata.get('License-Expression') or d.metadata.get('License') or 'See upstream license',text='\\n\\n'.join(files)))
paths=[pathlib.Path(sysconfig.get_path('stdlib'))/'LICENSE.txt',pathlib.Path(sys.base_prefix)/'LICENSE.txt']
items.append(dict(name='Python',version=sys.version.split()[0],url='https://www.python.org',license='PSF-2.0',text=next((p.read_text() for p in paths if p.exists()),'')))
print(json.dumps(items))`;
const result=spawnSync(process.env.CHEMEZ_LICENSE_PYTHON||runtimePython,['-c',script],{encoding:'utf8',maxBuffer:16*1024*1024});
if(result.status!==0)throw new Error('Python license inventory failed: '+result.stderr);
for(const item of JSON.parse(result.stdout)){
 const {text,...metadata}=item;if(!text)missing.push('python:'+item.name);
 await append({id:'python-'+item.name,...metadata,url:metadata.url||'https://pypi.org/project/'+encodeURIComponent(item.name),group:'software',note:'Bundled Python runtime dependency; collected from distribution metadata.'},text);
}
const electronVersion=JSON.parse(await readFile(path.join(root,'node_modules/electron/package.json'),'utf8')).version;
for(const [name,file,license] of [['Electron','LICENSE','MIT'],['Chromium notices','LICENSES.chromium.html','Multiple upstream licenses']]){
 const candidates=name==='Electron'
  ? [path.join(root,'node_modules/electron/LICENSE'),path.join(root,'node_modules/electron/dist/LICENSE')]
  : [path.join(root,'node_modules/electron/dist/LICENSES.chromium.html'),...(electronVersion==='45.0.0'?[path.join(root,'licenses/chromium-LICENSES-electron-45.html.gz')]:[])];
 let text;
 for(const candidate of candidates){try{text=candidate.endsWith('.gz')?gunzipSync(await readFile(candidate)).toString('utf8'):await readFile(candidate,'utf8');break;}catch(error){if(error.code!=='ENOENT')throw error;}}
 if(!text)throw new Error('Missing '+name+' license text for Electron '+electronVersion);
 await append({id:name==='Electron'?'electron':'chromium',name,url:'https://github.com/electron/electron',version:electronVersion,group:'software',license,note:'Desktop runtime; original notices also ship with Electron.'},text);
}
await writeFile(path.join(output,'credits.json'),JSON.stringify({schemaVersion:1,entries,missingLicenseFiles:missing},null,2));
const notices=['# Third-party notices','Generated from release-config/attributions.json and the locked dependency inventories.','Bundled software/data and reference-only projects are identified separately.','The original license texts are available offline in About → Credits & licenses.'];
for(const e of entries)notices.push(`## ${e.name}${e.version?' '+e.version:''}\n\nRelationship: ${e.group}\n\nSource: ${e.url}\n\nLicense: ${e.license}\n\n${e.note}`);
await writeFile(path.join(root,'dist/THIRD_PARTY_NOTICES.md'),notices.join('\n\n')+'\n');
await writeFile(path.join(output,'inventory.json'),JSON.stringify({schemaVersion:1,components:entries.filter(e=>e.group!=='reference').map(({licenseFiles,...e})=>e),missingLicenseFiles:missing},null,2));
console.log(`Attributions: ${entries.length} entries; ${missing.length} missing license texts (public release gate).`);
