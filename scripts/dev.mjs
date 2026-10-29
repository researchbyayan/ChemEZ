import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {root} from './python-path.mjs';
const require=createRequire(import.meta.url);
const vite=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/vite/bin/vite.js',import.meta.url))],{cwd:root,stdio:'inherit'});
let desktop;
const stop=()=>{desktop?.kill();vite.kill();};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
for(let i=0;i<100;i++){
  try{await fetch('http://127.0.0.1:5173');break;}catch{await new Promise(r=>setTimeout(r,100));}
}
desktop=spawn(require('electron'),['.'],{cwd:root,stdio:'inherit',env:{...process.env,CHEMEZ_DEV:'1'}});
desktop.on('exit',code=>{vite.kill();process.exitCode=code??1;});
