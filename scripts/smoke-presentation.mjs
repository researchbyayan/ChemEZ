import {_electron as electron,expect} from '@playwright/test';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm,mkdir,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import os from 'node:os';import path from 'node:path';
import {root,python} from './python-path.mjs';
const profile=await mkdtemp(path.join(os.tmpdir(),'ChemEZ structure preview '));
const examples=JSON.parse(await readFile(path.join(root,'tmp/chemistry-fixes/examples.json'),'utf8'));
const server=createServer((request,response)=>{let body='';request.on('data',c=>body+=c);request.on('end',()=>{const item=body.toLowerCase().includes('benzene resonance')?examples[1]:examples[0];response.writeHead(200,{'Content-Type':'text/event-stream'});response.end('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify(item.raw)}}]})+'\n\ndata: [DONE]\n\n');});});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const endpoint=`http://127.0.0.1:${server.address().port}/v1`;
const executable=process.env.CHEMEZ_ELECTRON_EXE;
const app=await electron.launch({...(executable?{executablePath:executable,args:[]}:{args:[path.join(root,'electron/main.cjs')]}),env:{...process.env,CHEMEZ_PROFILE:profile,CHEMEZ_SESSION_ONLY:'1'},timeout:60000});
try{
 const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.evaluate(()=>localStorage.setItem('chemez-level','undergraduate'));
 await page.evaluate(config=>window.chemez.request('saveConfig',config),{provider:'compatible',model:'presentation-test',endpoint,auth_mode:'none'});await page.reload();
 await expect(page.getByRole('textbox',{name:'Chemistry question'})).toBeVisible({timeout:60000});
 await mkdir(path.join(root,'tmp/chemistry-fixes/screenshots'),{recursive:true});
 for(const title of ['Butan-1-ol structure','Benzene resonance']){
  await page.getByRole('button',{name:'New conversation',exact:true}).click();
  await page.getByRole('textbox',{name:'Chemistry question'}).fill(title);
  await page.getByRole('button',{name:'Send question',exact:true}).click();
  await expect(page.locator('.message.assistant .answer-flow img').first()).toBeVisible({timeout:45000});
  await expect(page.locator('.answer-flow')).toBeVisible();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('.message.assistant img')).every(i=>i.complete&&i.naturalWidth>0));
  if(title.startsWith('Butan'))await expect(page.locator('.reaction-card')).toHaveCount(0);
  else {await expect(page.locator('.resonance-layout .structure')).toHaveCount(2);await expect(page.locator('.resonance-hybrid')).toHaveCount(1);}
  await expect(page.locator('.atom-loader,.answer-skeleton')).toHaveCount(0);
  await page.screenshot({path:path.join(root,'tmp/chemistry-fixes/screenshots',title.startsWith('Butan')?'butanol.png':'benzene.png')});
  if(title.startsWith('Butan')){
   await page.getByRole('button',{name:'Details for Butan-1-ol molecular structure'}).hover();
   await page.getByRole('button',{name:'Explore structure'}).click();
   await expect(page.getByRole('tab',{name:'3D model'})).toHaveAttribute('aria-selected','true');
   await expect(page.getByRole('img',{name:'Rotatable 3D model'})).toBeVisible({timeout:30000});
   await mkdir(path.join(root,'tmp/wiley-research/screenshots'),{recursive:true});
   await page.screenshot({path:path.join(root,'tmp/wiley-research/screenshots/chemez-3d-default.png')});
   await page.getByRole('tab',{name:'2D structure'}).click();
   await page.getByRole('checkbox',{name:'Lone pairs'}).check();
   await expect(page.getByRole('img',{name:'Structure showing lone electron pairs'})).toBeVisible({timeout:30000});
   await page.getByRole('checkbox',{name:'Show hydrogens'}).check();
   await mkdir(path.join(root,'tmp/wiley-research/screenshots'),{recursive:true});
   await page.screenshot({path:path.join(root,'tmp/wiley-research/screenshots/chemez-lewis.png')});
   await page.getByRole('button',{name:'Close Butan-1-ol'}).click();
  }
 }
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('Presentation smoke passed: isolated structure, two Kekulé contributors, separate hybrid, static UI, no renderer errors. Local mock provider through real streaming and native validation; no hosted model calls.');
}finally{await app.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true});}
