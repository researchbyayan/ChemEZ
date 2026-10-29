import {_electron as electron,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {root} from './python-path.mjs';
const calls=[];
const server=createServer((request,response)=>{
 let text='';request.on('data',c=>text+=c);request.on('end',()=>{
  if(request.url==='/v1/models'){response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({data:[{id:'chat-model'},{id:'vision-model'}]}));return;}
  const body=JSON.parse(text);calls.push(body);
  const vision=body.model==='vision-model';
  const images=body.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(p=>p.type==='image_url');
  if(vision&&!images.length)throw new Error('Vision request lost the image');
  if(!vision&&images.length)throw new Error('Text model received raw images');
  const content=vision?'Visible structure: ethanol with a terminal OH. No stereochemistry indicated.':JSON.stringify({blocks:[{type:'markdown',text:'The image shows ethanol, a primary alcohol.'},{type:'molecule',smiles:'CCO',label:'Ethanol',formula:'C2H6O'}]});
  response.writeHead(200,{'Content-Type':'text/event-stream'});response.end('data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\ndata: [DONE]\n\n');
 });
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profile=await mkdtemp(path.join(os.tmpdir(),'ChemEZ dual API '));
let app;
try{
 const packaged=process.argv.includes('--packaged');
 const executable=process.env.CHEMEZ_ELECTRON_EXE||path.join(root,'release',process.platform==='darwin'?(process.arch==='arm64'?'mac-arm64':'mac')+'/ChemEZ.app/Contents/MacOS/ChemEZ':process.platform==='win32'?'win-unpacked/ChemEZ.exe':'linux-unpacked/chemez');
 const args=packaged?[]:[path.join(root,'electron/main.cjs')];
 if(process.argv.includes('--no-sandbox'))args.push('--no-sandbox');
 app=await electron.launch({...(packaged?{executablePath:executable}:{}),args,env:{...process.env,CHEMEZ_PROFILE:profile,CHEMEZ_SESSION_ONLY:'1'},timeout:60000});
 const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await expect(page.getByRole('textbox',{name:'Chemistry question'})).toBeVisible({timeout:60000});
 const welcome=page.getByRole('dialog',{name:'Welcome to ChemEZ'});
 if(await welcome.isVisible().catch(()=>false)||await welcome.waitFor({timeout:5000}).then(()=>true,()=>false))await welcome.getByRole('radio',{name:/University/}).click();
 const endpoint=`http://127.0.0.1:${server.address().port}/v1`;
 await page.evaluate(config=>window.chemez.request('saveConfig',config),{provider:'compatible',endpoint,model:'chat-model',api_key:'synthetic-chat-key'});
 await page.reload();
 await page.getByRole('button',{name:'Model settings'}).click();
 await page.getByRole('tab',{name:/Image reader/}).click();
 await expect(page.getByText(/not an image generator/)).toBeVisible();
 await page.getByRole('radio',{name:/Custom/}).click();
 await page.getByLabel('API base URL').fill(endpoint);
 await page.getByLabel('API key',{exact:true}).fill('synthetic-vision-key');
 await expect(page.getByLabel('Model',{exact:true})).toBeVisible({timeout:30000});
 await page.getByLabel('Model',{exact:true}).selectOption('vision-model');
 await page.getByRole('button',{name:'Save & connect'}).click();
 await expect(page.getByText(/Image reader connected/)).toBeVisible({timeout:30000});
 await mkdir(path.join(root,'test-results'),{recursive:true});
 await page.locator('dialog').evaluate(el=>{el.scrollTop=0;});
 await page.screenshot({path:path.join(root,'test-results/dual-api-settings.png')});
 await page.getByRole('button',{name:'Start chatting'}).click();
 const data=(await readFile(path.join(root,'evaluation/fixtures/ethanol.png'))).toString('base64');
 await page.evaluate(data=>{const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],'ethanol.png',{type:'image/png'}));document.querySelector('.composer').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));},data);
 await page.getByRole('textbox',{name:'Chemistry question'}).fill('Identify the molecule in this image.');
 await expect(page.locator('.attachment')).toHaveCount(1);
 await page.getByRole('button',{name:'Send question',exact:true}).click();
 await expect(page.getByRole('img',{name:'Ethanol molecular structure',exact:true})).toBeVisible({timeout:30000});
 await page.screenshot({path:path.join(root,'test-results/dual-api-answer.png')});
 const state=await page.evaluate(()=>window.chemez.request('getConfig'));
 if(state.config.model!=='chat-model'||state.vision_config.model!=='vision-model')throw new Error('Model roles overwrote one another');
 if(calls.filter(c=>c.model==='vision-model').length<2||calls.filter(c=>c.model==='chat-model').length<1)throw new Error('Expected both model roles to receive their requests.');
 if(!calls.some(call=>call.model==='chat-model'&&JSON.stringify(call.messages).includes('Visible structure: ethanol')))throw new Error('Observations never reached chemistry model');
 await page.getByRole('button',{name:'Model settings'}).click();
 await page.getByRole('tab',{name:/Image reader/}).click();
 await page.getByRole('button',{name:'Disable image reader and remove its key'}).click();
 await expect.poll(()=>page.evaluate(async()=>!(await window.chemez.request('getConfig')).vision_config)).toBe(true);
 if(errors.length)throw new Error(errors.join('\n'));
 // Force an App initializer failure, before answer-level boundaries can help.
 await page.addInitScript(()=>{const original=Storage.prototype.getItem;Storage.prototype.getItem=function(key){if(key==='chemez-draft')throw new Error('Synthetic app-shell failure');return original.call(this,key);};});
 await page.reload();
 await expect(page.getByRole('heading',{name:'ChemEZ could not display this view'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Reload ChemEZ'})).toBeVisible();
 await page.screenshot({path:path.join(root,'test-results/app-shell-recovery.png')});
 console.log('Dual API smoke passed: settings, independent keys/models, real image transport, observation handoff, rendering, disable, and app-shell render-failure containment.');
}finally{
 if(app)await app.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true});
}
