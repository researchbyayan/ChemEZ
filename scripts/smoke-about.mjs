import {_electron as electron,expect} from '@playwright/test';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';import {createServer} from 'node:http';import path from 'node:path';import os from 'node:os';
import {root} from './python-path.mjs';
const profile=await mkdtemp(path.join(os.tmpdir(),'ChemEZ release QA ü '));const packaged=process.argv.includes('--packaged');
const executable=process.env.CHEMEZ_ELECTRON_EXE||(packaged?path.join(root,'release',process.platform==='darwin'?(process.arch==='arm64'?'mac-arm64':'mac')+'/ChemEZ.app/Contents/MacOS/ChemEZ':process.platform==='win32'?'win-unpacked/ChemEZ.exe':'linux-unpacked/chemez'):undefined);
const answer={blocks:[{type:'reaction',caption:'Grignard addition to a ketone gives a tertiary alcohol',reactants:[{smiles:'CC(=O)C',label:'Acetone'},{smiles:'C[Mg]Br',label:'Methylmagnesium bromide'}],products:[{smiles:'CC(C)(C)O',label:'tert-Butanol'}],reagents:'1. CH3MgBr, Et2O  2. H3O+',conditions:'Dry ether, then dilute acid'}]};
const server=createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{const content=body.includes('single most useful next message')?'What controls the selectivity of Grignard addition?':JSON.stringify(answer);res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\ndata: [DONE]\n\n');});});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let instance;
try{
 instance=await electron.launch({...(executable?{executablePath:executable,args:[]}:{args:[path.join(root,'electron/main.cjs')]}),env:{...process.env,CHEMEZ_PROFILE:profile,CHEMEZ_SESSION_ONLY:'1'},timeout:60000});
 const page=await instance.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.evaluate(()=>localStorage.setItem('chemez-level','undergraduate'));
 await page.evaluate(config=>window.chemez.request('saveConfig',config),{provider:'compatible',endpoint:`http://127.0.0.1:${server.address().port}/v1`,model:'release-fixture',auth_mode:'none'});await page.reload();
 if(process.argv.includes('--preview-only')||process.argv.includes('--capture-readme')){
  await page.getByRole('textbox',{name:'Chemistry question'}).fill('Show Grignard addition of methylmagnesium bromide to acetone');await page.getByRole('button',{name:'Send question',exact:true}).click();await expect(page.locator('.reaction-card')).toBeVisible({timeout:60000});
  if(process.argv.includes('--capture-readme')){
   await mkdir(path.join(root,'docs/images'),{recursive:true});
   await page.locator('.reaction-card').evaluate(el=>{el.style.width='340px';el.style.maxWidth='100%';});
   await page.waitForFunction(()=>Array.from(document.querySelectorAll('.reaction-card img')).every(image=>image.complete&&image.naturalWidth));
   await page.locator('.reaction-card').screenshot({path:path.join(root,'docs/images/reaction-example.png')});
   console.log('README reaction screenshot captured from the app.');
  }else{
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'About',exact:true}).click();
  await expect(page.locator('.about-app-menu')).toBeVisible();await instance.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setSize(1100,820);win.show();win.focus();});await page.bringToFront();
  await mkdir(path.join(root,'test-results/release'),{recursive:true});await page.screenshot({path:path.join(root,'test-results/release/about-curated.png')});
  console.log('CURATED PREVIEW OPEN: your profile, Application controls and Open source are separate; pill actions match. Close Settings to view the divider and reaction header.');
  await new Promise(resolve=>instance.on('close',resolve));
  }
 }else{
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'About',exact:true}).click();
 await expect(page.getByText('Application license: MIT.',{exact:false})).toBeVisible();
 await page.getByText(/Credits & licenses \(/).click();await page.getByLabel('Search credits').fill('seq_encode');await page.locator('.credit-entry summary').filter({hasText:'seq_encode'}).click();await page.getByRole('button',{name:'Read license',exact:true}).click();await expect(page.locator('.license-reader pre')).toContainText('MIT');
 const result=await page.evaluate(()=>window.chemez.license('../../credentials').then(()=>false,()=>true));if(!result)throw new Error('License path traversal accepted.');
 await page.getByText('App details',{exact:true}).click();await page.getByRole('button',{name:'Copy app information'}).click();await expect(page.getByRole('status')).toContainText('App information copied.');
 await mkdir(path.join(root,'test-results/release'),{recursive:true});await page.screenshot({path:path.join(root,'test-results/release/about.png')});
 await page.keyboard.press('Escape');
 await page.getByRole('textbox',{name:'Chemistry question'}).fill('Show Grignard addition of methylmagnesium bromide to acetone');await page.getByRole('button',{name:'Send question',exact:true}).click();
 await expect(page.locator('.reaction-card')).toBeVisible({timeout:60000});await expect(page.getByRole('button',{name:'Send question',exact:true})).toBeVisible({timeout:60000});
 for(const width of [360,480,760]){
  await instance.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setSize(width,900),width);
  // Measure the narrow-card case even when the desktop window has a larger minimum width.
  await page.locator('.reaction-card').evaluate((el,width)=>{el.style.width=Math.min(width-32,340)+'px';el.style.maxWidth='100%';},width);
  const overlap=await page.locator('.reaction-card figcaption').evaluate(el=>{const a=el.querySelector('strong').getBoundingClientRect(),b=el.querySelector('.card-tools').getBoundingClientRect();return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;});if(overlap)throw new Error('Reaction title overlaps tools at '+width);
 }
 await page.locator('.reaction-card').screenshot({path:path.join(root,'test-results/release/reaction-header.png')});
 const separator=await page.locator('.composer-area').evaluate(el=>{const s=getComputedStyle(el,'::before');return {height:s.height,image:s.backgroundImage,pointer:s.pointerEvents};});if(separator.height!=='1px'||!separator.image.includes('linear-gradient')||separator.pointer!=='none')throw new Error('Fading composer divider is missing.');
 if(process.argv.includes('--keep-open')){
  await instance.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setSize(1100,820);win.show();win.focus();});
  await page.locator('.reaction-card').evaluate(el=>{el.style.width='';el.style.maxWidth='';});
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'About',exact:true}).click();
  await page.bringToFront();console.log('PREVIEW OPEN: About contains the new credits; close Settings to inspect the reaction and fading separator. Isolated local fixture, not your API profile.');
  await new Promise(resolve=>instance.on('close',resolve));
 }
 if(errors.length)throw new Error(errors.join('\n'));console.log('About, offline credits/licenses, MIT, identifier safety, clipboard, header overlap and fading separator passed. Local fixture; no live model calls.');
}
}finally{await instance?.close().catch(()=>{});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true});}
