import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {python,root} from './python-path.mjs';
function run(cmd,args){const r=spawnSync(cmd,args,{cwd:root,stdio:'inherit'});if(r.error||r.status!==0)throw new Error(`${cmd} failed. Install Python 3.11 or 3.12 and rerun setup. ${r.error?.message||''}`);}
if(!existsSync(python)){
  const candidates=process.env.CHEMEZ_PYTHON?[{cmd:process.env.CHEMEZ_PYTHON,args:[]}]:process.platform==='win32'?[{cmd:'python',args:[]},{cmd:'py',args:['-3.11']},{cmd:'py',args:['-3.12']}]:[{cmd:'python3.11',args:[]},{cmd:'python3.12',args:[]}];
  const selected=candidates.find(c=>spawnSync(c.cmd,[...c.args,'-c','import sys; assert (3,11)<=sys.version_info[:2]<=(3,12)']).status===0);
  if(!selected)throw new Error('Install Python 3.11 or 3.12, or set CHEMEZ_PYTHON to its executable path.');
  run(selected.cmd,[...selected.args,'-m','venv','.venv']);
}
run(python,['-m','pip','install','--upgrade','pip']);
run(python,['-m','pip','install','-r','backend/requirements.txt']);
