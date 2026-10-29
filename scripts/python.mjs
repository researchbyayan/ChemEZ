import {spawnSync} from 'node:child_process';
import {python,root} from './python-path.mjs';
const result=spawnSync(python,process.argv.slice(2),{cwd:root,stdio:'inherit'});
if(result.error) console.error('Run npm run setup first:',result.error.message);
process.exit(result.status??1);
