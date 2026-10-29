import {spawnSync} from 'node:child_process';
import {root} from './python-path.mjs';
const before=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout?.trim();
for(const [exe,args] of [[process.execPath,['node_modules/typescript/bin/tsc','--noEmit']],[process.execPath,['node_modules/vite/bin/vite.js','build']],[process.execPath,['scripts/licenses.mjs']],[process.execPath,['scripts/build-info.mjs']]]){
 const result=spawnSync(exe,args,{cwd:root,stdio:'inherit',env:{...process.env,CHEMEZ_BUILD_COMMIT:before}});if(result.status!==0)process.exit(result.status||1);
}
