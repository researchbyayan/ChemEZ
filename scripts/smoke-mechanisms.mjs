import {_electron as electron,expect} from '@playwright/test';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import os from 'node:os';import path from 'node:path';
import {root} from './python-path.mjs';
const cases=[
 {question:'Draw butane',name:'butane',raw:{blocks:[{type:'reaction',reactants:[{smiles:'CCCC',label:'Butane'}],products:[{smiles:'CCCC',label:'Butane'}],reagents:'None',conditions:'None',caption:'Structure of Butane'}]}},
 {question:'Show acetate resonance',name:'acetate',raw:{blocks:[{type:'resonance',caption:'Acetate resonance',contributors:[{smiles:'CC(=O)[O-]',arrows:[{tail:[3],head:[1,3]},{tail:[1,2],head:[2]}]},{smiles:'CC([O-])=O'}]}]}},
 {question:'Show SN2 mechanism of hydroxide and bromomethane',name:'sn2',raw:{blocks:[{type:'mechanism',steps:[{smiles:'[OH-].CBr',label:'Lone-pair attack and bromide departure',arrows:[{tail:[0],head:[1]},{tail:[1,2],head:[2]}]},{smiles:'CO.[Br-]',label:'Methanol and bromide',limitation:'Final products.'}]}]}}
];
cases.push({question:'Benzene resonating structures',name:'benzene',raw:{blocks:[{type:'resonance',contributors:[{smiles:'c1ccccc1'},{smiles:'c1ccccc1'}],hybrid:true}]}});
const profile=await mkdtemp(path.join(os.tmpdir(),'ChemEZ mechanism preview '));
let current=cases[0];
const server=createServer((req,res)=>{req.resume();req.on('end',()=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify(current.raw)}}]})+'\n\ndata: [DONE]\n\n');});});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const app=await electron.launch({...(process.env.CHEMEZ_ELECTRON_EXE?{executablePath:process.env.CHEMEZ_ELECTRON_EXE,args:[]}:{args:[path.join(root,'electron/main.cjs')]}),env:{...process.env,CHEMEZ_PROFILE:profile,CHEMEZ_SESSION_ONLY:'1'},timeout:60000});
try{
 const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.evaluate(()=>localStorage.setItem('chemez-level','undergraduate'));
 await page.evaluate(config=>window.chemez.request('saveConfig',config),{provider:'compatible',model:'mechanism-fixture',endpoint:`http://127.0.0.1:${server.address().port}/v1`,auth_mode:'none'});await page.reload();
 await mkdir(path.join(root,'tmp/mechanism-fixes/screenshots'),{recursive:true});
 for(const item of cases){
  current=item;await page.getByRole('button',{name:'New conversation',exact:true}).click();
  await page.getByLabel('Answer style').selectOption(item.name==='sn2'?'mechanism':'balanced');
  await page.getByRole('textbox',{name:'Chemistry question'}).fill(item.question);await page.getByRole('button',{name:'Send question',exact:true}).click();
  await expect(page.locator('.answer-flow img').first()).toBeVisible({timeout:60000});
  await expect(page.getByRole('button',{name:'Send question',exact:true})).toBeVisible({timeout:60000});
  await expect(page.locator('.notice.error,.message-avatar,.atom-loader')).toHaveCount(0);
  if(item.name==='butane'){
   await expect(page.locator('.reaction-card')).toHaveCount(0);await expect(page.locator('.molecule-row .structure')).toHaveCount(1);
   // Restore the same chat through the real SQLite-backed route.
   await page.reload();await expect(page.locator('.molecule-row .structure')).toHaveCount(1,{timeout:60000});
  }else if(item.name==='sn2'){
   await expect(page.locator('.mechanism-step')).toHaveCount(2);await expect(page.getByLabel('Bond changes')).toContainText('Forms O–C');await expect(page.getByLabel('Bond changes')).toContainText('Breaks C–Br');
  }else {await expect(page.locator('.resonance-term')).toHaveCount(2);if(item.name==='benzene'){await expect(page.locator('.resonance-flow-summary')).toContainText('Three π-electron pairs');await expect(page.locator('.resonance-bond-changes')).toHaveCount(0);const images=await page.locator('.resonance-term img').evaluateAll(images=>images.map(image=>{const r=image.getBoundingClientRect();return {top:r.top,height:r.height};}));expect(Math.abs(images[0].top-images[1].top)).toBeLessThan(1);expect(Math.abs(images[0].height-images[1].height)).toBeLessThan(1);}}
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('.answer-flow img')).every(i=>i.complete&&i.naturalWidth));
  await page.screenshot({path:path.join(root,'tmp/mechanism-fixes/screenshots',item.name+'.png')});
  if(item.name==='benzene')await page.locator('.resonance-card').screenshot({path:path.join(root,'tmp/mechanism-fixes/screenshots/benzene-detail.png')});
  if(item.name==='sn2')await page.locator('.mechanism').screenshot({path:path.join(root,'tmp/mechanism-fixes/screenshots/mechanism-detail.png')});
 }
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('Passed: one butane on creation and restoration; acetate and aligned benzene resonance; SN2 lone-pair arrows and verified bond changes; no answer avatars. Local fixtures, real backend, no hosted API calls.');
}catch(error){const page=await app.firstWindow();await page.screenshot({path:path.join(root,'tmp/mechanism-fixes/screenshots/failure.png')}).catch(()=>{});console.error(await page.locator('body').innerText().catch(()=>''));throw error;}finally{await app.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true});}
