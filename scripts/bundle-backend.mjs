import {spawnSync} from 'node:child_process';
import {python,root,runtimePython} from './python-path.mjs';
const args=['-m','PyInstaller','--noconfirm','--onedir','--name','chemez-backend','--distpath','backend-dist','--workpath','build/python','--specpath','build','--paths','backend','--paths','backend/vendor','--collect-data','rdkit','--collect-binaries','rdkit','--hidden-import','seq_encode.smiles','--hidden-import','uvicorn.logging','--hidden-import','uvicorn.loops.auto','--hidden-import','uvicorn.protocols.http.auto','--hidden-import','uvicorn.protocols.http.h11_impl','--hidden-import','uvicorn.lifespan.on'];
if(process.env.CHEMEZ_CLEAN_BUILD==='1')args.push('--clean');
for(const dependency of ['fastapi','uvicorn','httpx','pydantic','rdkit','numpy','tqdm']) args.push('--recursive-copy-metadata',dependency);
// The question map is read at run time, so it ships beside the chemez package.
args.push('--add-data',root+'/backend/chemez/question_map.json:chemez');
args.push('--add-data',root+'/backend/chemez/data/c13_shifts.json.gz:chemez/data');
args.push('--add-data',root+'/licenses/nmrshiftdb2-database-license.txt:chemez/data');
args.push('--add-data',root+'/backend/chemez/data/NOTICE.txt:chemez/data');
args.push('backend/run.py');
for(const module of ['pytest','tkinter','IPython','matplotlib'])args.push('--exclude-module',module);
const result=spawnSync(runtimePython,args,{cwd:root,stdio:'inherit',env:{...process.env,PYINSTALLER_CONFIG_DIR:root+'/build/pyinstaller-cache'}});
process.exit(result.status??1);
