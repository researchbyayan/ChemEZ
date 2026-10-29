import {cp,mkdir,readdir,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {root} from './python-path.mjs';
const stage=path.join(root,'build/desktop-app');await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true});
await cp(path.join(root,'dist'),path.join(stage,'dist'),{recursive:true});
for(const dir of ['electron','shared']){
 await mkdir(path.join(stage,dir),{recursive:true});
 for(const file of await readdir(path.join(root,dir))){if(/\.(test|spec)\./.test(file)||!(/\.(cjs|mjs)$/.test(file)))continue;
  const text=await readFile(path.join(root,dir,file),'utf8');
  for(const match of text.matchAll(/require\(['"]([^'"]+)['"]\)/g))if(!match[1].startsWith('.')&&!match[1].startsWith('node:')&&match[1]!=='electron')throw new Error('Register the main-process runtime dependency before staging: '+match[1]);
  await cp(path.join(root,dir,file),path.join(stage,dir,file));
 }
}
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
await writeFile(path.join(stage,'package.json'),JSON.stringify({name:pkg.name,version:pkg.version,description:pkg.description,author:pkg.author,license:pkg.license,main:pkg.main,private:true},null,2));
console.log('Staged desktop app without duplicate browser node_modules.');
