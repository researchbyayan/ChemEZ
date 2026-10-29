import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {root,python} from './python-path.mjs';
const lock=JSON.parse(await readFile(path.join(root,'package-lock.json'),'utf8'));
const notices=['ChemEZ bundled JavaScript dependency licenses\nSee THIRD_PARTY_NOTICES.md for source attribution.'];
for(const [location,metadata] of Object.entries(lock.packages)){
  if(!location||metadata.dev)continue;
  const directory=path.join(root,location);
  let files;
  try{files=await readdir(directory,{withFileTypes:true});}catch{continue;}
  const name=location.split('node_modules/').at(-1);
  notices.push(`\n${'='.repeat(72)}\n${name} ${metadata.version}\nLicense: ${metadata.license||'See source'}\n${metadata.resolved||''}\n`);
  for(const file of files){if(file.isFile()&&/^(licen[cs]e|copying|notice)/i.test(file.name))notices.push(await readFile(path.join(directory,file.name),'utf8'));}
}
await mkdir(path.join(root,'dist'),{recursive:true});
await writeFile(path.join(root,'dist','THIRD_PARTY_LICENSES.txt'),notices.join('\n'));
// Python's own license is outside pip metadata. Include it alongside the UI assets.
const result=spawnSync(python,['-c',"import pathlib,sysconfig,sys; candidates=[pathlib.Path(sysconfig.get_path('stdlib'))/'LICENSE.txt',pathlib.Path(sys.base_prefix)/'LICENSE.txt']; print(next((str(p) for p in candidates if p.exists()),''))"],{encoding:'utf8'});
if(result.status===0&&result.stdout.trim())await writeFile(path.join(root,'dist','PYTHON_LICENSE.txt'),await readFile(result.stdout.trim()));

await import('./attributions.mjs');
