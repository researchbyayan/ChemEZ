import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {root,python} from './python-path.mjs';
const directory=path.join(root,'build/runtime-venv'),runtime=path.join(directory,process.platform==='win32'?'Scripts/python.exe':'bin/python');
function run(exe,args){const result=spawnSync(exe,args,{cwd:root,stdio:'inherit'});if(result.status!==0)throw new Error('Isolated runtime setup failed.');}
if(!existsSync(runtime))run(python,['-m','venv',directory]);
run(runtime,['-m','pip','install','-c','backend/constraints-runtime.txt','-r','backend/requirements-runtime.txt','pyinstaller==6.13.0','setuptools==84.2.1']);
console.log('Native runtime/build environment ready; testing dependencies are separate.');
