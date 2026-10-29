import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {root,python,runtimePython} from './python-path.mjs';
function git(args){const p=spawnSync('git',args,{cwd:root,encoding:'utf8'});if(p.status!==0)throw new Error('Git checkpoint metadata unavailable.');return p.stdout.trim();}
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const runtime=spawnSync(runtimePython,['-c','import sys,platform,json; print(json.dumps({"python":sys.version.split()[0],"machine":platform.machine()}))'],{encoding:'utf8'});if(runtime.status!==0)throw new Error('Cannot identify backend build runtime.');
const backend=JSON.parse(runtime.stdout),arch={x86_64:'x64',AMD64:'x64',arm64:'arm64',aarch64:'arm64'}[backend.machine];
if(arch!==process.arch)throw new Error(`Backend ${arch} does not match Node ${process.arch}. Native builds are required.`);
if(process.env.CHEMEZ_BUILD_COMMIT&&process.env.CHEMEZ_BUILD_COMMIT!==git(['rev-parse','HEAD']))throw new Error('Source checkpoint changed during the build. Rebuild after Claude finishes.');
const info={schemaVersion:1,version:pkg.version,commit:git(['rev-parse','HEAD']),dirty:!!git(['status','--porcelain','--untracked-files=normal']),platform:process.platform,arch:process.arch,node:process.versions.node,python:backend.python,electron:JSON.parse(await readFile(path.join(root,'node_modules/electron/package.json'),'utf8')).version,builder:JSON.parse(await readFile(path.join(root,'node_modules/electron-builder/package.json'),'utf8')).version,os:os.release()};
await mkdir(path.join(root,'dist/release'),{recursive:true});await writeFile(path.join(root,'dist/release/build.json'),JSON.stringify(info,null,2)+'\n');console.log(`Build ${info.commit.slice(0,12)} ${info.platform}/${arch}${info.dirty?' (local changes)':''}`);
