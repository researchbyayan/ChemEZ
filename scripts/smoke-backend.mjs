import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {root} from './python-path.mjs';
const directory=await mkdtemp(path.join(os.tmpdir(),'ChemEZ smoke with spaces '));
const token=randomBytes(32).toString('hex');
const exe=process.env.CHEMEZ_BACKEND_EXE||path.join(root,'backend-dist','chemez-backend',process.platform==='win32'?'chemez-backend.exe':'chemez-backend');
const child=spawn(exe,[],{env:{...process.env,CHEMEZ_TOKEN:token,CHEMEZ_DATA_DIR:directory},stdio:['ignore','pipe','pipe']});
const timer=setTimeout(()=>{child.kill();console.error('Backend smoke timed out');process.exitCode=1;},60000);
try{
  const port=await new Promise((resolve,reject)=>{
    let buffer='';child.stdout.on('data',chunk=>{buffer+=chunk;for(const line of buffer.split('\n')){try{const data=JSON.parse(line);if(data.ready)resolve(data.port);}catch{}}});
    child.on('error',reject);child.on('exit',code=>reject(new Error(`Backend exited: ${code}`)));
  });
  const base=`http://127.0.0.1:${port}`;
  let response;
  for(let i=0;i<100;i++){try{response=await fetch(base+'/health',{headers:{Authorization:`Bearer ${token}`}});if(response.ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  if(!response?.ok)throw new Error('Health check failed');
  if((await fetch(base+'/health')).status!==401)throw new Error('Unauthenticated access was accepted');
  const config=await (await fetch(base+'/config',{headers:{Authorization:`Bearer ${token}`}})).json();
  if(config.has_key)throw new Error('Fresh profile unexpectedly contains credentials');
  console.log('Frozen backend: startup, authenticated health, credential-free profile, and paths with spaces passed.');
}finally{
  clearTimeout(timer);child.kill();
  await new Promise(resolve=>child.once('exit',resolve));
  await rm(directory,{recursive:true,force:true});
}
