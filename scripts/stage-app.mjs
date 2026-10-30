import {cp,mkdir,readdir,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {root} from './python-path.mjs';
// Main-process packages the app needs at run time; each is copied with its dependency tree.
const RUNTIME=['electron-updater'];
const stage=path.join(root,'build/desktop-app');await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true});
await cp(path.join(root,'dist'),path.join(stage,'dist'),{recursive:true});
for(const dir of ['electron','shared']){
 await mkdir(path.join(stage,dir),{recursive:true});
 for(const file of await readdir(path.join(root,dir))){if(/\.(test|spec)\./.test(file)||!(/\.(cjs|mjs)$/.test(file)))continue;
  const text=await readFile(path.join(root,dir,file),'utf8');
  for(const match of text.matchAll(/require\(['"]([^'"]+)['"]\)/g))if(!match[1].startsWith('.')&&!match[1].startsWith('node:')&&match[1]!=='electron'&&!RUNTIME.includes(match[1]))throw new Error('Register the main-process runtime dependency before staging: '+match[1]);
  await cp(path.join(root,dir,file),path.join(stage,dir,file));
 }
}
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const copied=new Set();
async function copyPackage(name){
 if(copied.has(name))return;copied.add(name);
 const from=path.join(root,'node_modules',name);
 await cp(from,path.join(stage,'node_modules',name),{recursive:true});
 const meta=JSON.parse(await readFile(path.join(from,'package.json'),'utf8'));
 for(const dep of Object.keys(meta.dependencies||{}))await copyPackage(dep);
}
for(const name of RUNTIME)await copyPackage(name);
await writeFile(path.join(stage,'package.json'),JSON.stringify({name:pkg.name,version:pkg.version,description:pkg.description,author:pkg.author,license:pkg.license,main:pkg.main,private:true,dependencies:Object.fromEntries(RUNTIME.map(name=>[name,pkg.dependencies[name]]))},null,2));
console.log('Staged desktop app without duplicate browser node_modules.');
