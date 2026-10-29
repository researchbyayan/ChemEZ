// Native image intake and resource regressions. No inference/network request is made:
// the configured text-only NVIDIA model is deliberately rejected by capability checks.
import {_electron as electron,expect} from '@playwright/test';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {root} from './python-path.mjs';

const directory=path.join(root,'evaluation','runs','image-safety-2026-10-26');
await mkdir(directory,{recursive:true});
const profile=await mkdtemp(path.join(os.tmpdir(),'ChemEZ image regressions '));
const instance=await electron.launch({args:[path.join(root,'electron','main.cjs')],env:{...process.env,CHEMEZ_PROFILE:profile,CHEMEZ_SESSION_ONLY:'1'},timeout:60000});
const page=await instance.firstWindow();
const failures=[],results=[];
page.on('pageerror',e=>failures.push(e.message));page.on('crash',()=>failures.push('Renderer crash'));
const fixture=name=>path.join(root,'evaluation','fixtures',name);
async function reset(){
  while(await page.locator('.attachment button').count())await page.locator('.attachment button').first().click();
  await page.getByRole('button',{name:'New conversation',exact:true}).click();
  await page.getByRole('textbox',{name:'Chemistry question'}).fill('');
}
async function drop(files,method='drop'){
  const payload=await Promise.all(files.map(async name=>({name,type:name.endsWith('.webp')?'image/webp':name.endsWith('.jpg')?'image/jpeg':'image/png',data:(await readFile(fixture(name))).toString('base64')})));
  await page.evaluate(({files,method})=>{
    const transfer=new DataTransfer();
    for(const file of files){const bytes=Uint8Array.from(atob(file.data),c=>c.charCodeAt(0));transfer.items.add(new File([bytes],file.name,{type:file.type}));}
    document.querySelector('.composer').dispatchEvent(method==='paste'?new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}):new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));
  },{files:payload,method});
}
async function test(id,title,run){
  const before=failures.length;
  try{await reset();await run();await expect(page.getByRole('textbox',{name:'Chemistry question'})).toBeEditable();results.push({id,title,status:'passed',pageErrors:failures.slice(before)});}
  catch(error){results.push({id,title,status:'failed',error:String(error),pageErrors:failures.slice(before)});}
  await page.screenshot({path:path.join(directory,id+'.png')});
  await writeFile(path.join(directory,'results.json'),JSON.stringify({kind:'native-image-safety-no-inference',results,failures},null,2));
  console.log(id,results.at(-1).status,title);
}
try{
  await page.evaluate(async()=>{await window.chemez.request('saveConfig',{provider:'compatible',model:'nvidia/nemotron-3.5-bolt-e4b',endpoint:'https://integrate.api.nvidia.com/v1',api_key:'synthetic-capability-check-not-a-real-key'});});
  await page.reload();await expect(page.getByRole('textbox',{name:'Chemistry question'})).toBeVisible();
  await test('I01','Native PNG picker retains attachment and explains text-only capability',async()=>{
    await instance.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},fixture('ethanol.png'));
    await page.getByRole('button',{name:'Attach chemistry image'}).click();
    await expect(page.getByLabel('Attached images')).toBeVisible();
    await expect(page.getByText('This model is text-only.')).toBeVisible();
    await page.getByRole('button',{name:'Send question'}).click();
    await expect(page.getByRole('alert')).toContainText('accepts text only');
    await expect(page.locator('.attachment')).toHaveCount(1);
  });
  await test('I02','Clipboard PNG paste',async()=>{await drop(['benzaldehyde.png'],'paste');await expect(page.locator('.attachment')).toHaveCount(1);});
  await test('I03','Dropped JPEG is normalized to PNG',async()=>{await drop(['ethanol.jpg']);await expect(page.locator('.attachment img')).toHaveAttribute('src',/^data:image\/png/);});
  await test('I04','Dropped WebP is normalized to PNG',async()=>{await drop(['ethanol.webp']);await expect(page.locator('.attachment img')).toHaveAttribute('src',/^data:image\/png/);});
  await test('I05','Rotated image remains readable in preview',async()=>{await drop(['rotated.png']);await expect(page.locator('.attachment')).toHaveCount(1);});
  await test('I06','Four images can be attached safely',async()=>{await drop(['ethanol.png','benzaldehyde.png','aspirin.png','chiral.png']);await expect(page.locator('.attachment')).toHaveCount(4);});
  await test('I07','Five images are rejected atomically',async()=>{await drop(['ethanol.png','benzaldehyde.png','aspirin.png','chiral.png','blank.png']);await expect(page.getByRole('alert')).toContainText('up to four');await expect(page.locator('.attachment')).toHaveCount(0);});
  await test('I08','Corrupt PNG is rejected without a renderer failure',async()=>{await drop(['corrupt.png']);await expect(page.getByRole('alert')).toContainText('not a readable');});
  await test('I09','140 megapixel PNG rejected before native decode',async()=>{
    await instance.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},fixture('oversized-pixels.png'));
    await page.getByRole('button',{name:'Attach chemistry image'}).click();await expect(page.getByRole('alert')).toContainText('24 megapixels');
  });
  await test('I10','140 megapixel PNG rejected before clipboard decode',async()=>{await drop(['oversized-pixels.png'],'paste');await expect(page.getByRole('alert')).toContainText('24 megapixels');});
  await test('I11','Files above 15 MB are rejected',async()=>{
    await page.evaluate(()=>{const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(16*1024*1024)],'large.png',{type:'image/png'}));document.querySelector('.composer').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));});await expect(page.getByRole('alert')).toContainText('15 MB');
  });
  await test('I12','Backend also rejects text-only image calls bypassing the UI',async()=>{
    const data=(await readFile(fixture('blank.png'))).toString('base64');
    const events=await page.evaluate(async data=>{const events=[];const unsubscribe=window.chemez.onEvent(e=>events.push(e));await window.chemez.chat({text:'Identify this molecule.',images:[{name:'blank.png',mime:'image/png',data}],conversation_id:null,response_style:'balanced'});unsubscribe();return events;},data);
    if(!events.some(e=>e.type==='block'&&e.block?.text?.includes('accepts text only')))throw new Error('Backend capability guard failed.');
    await expect(page.getByRole('textbox',{name:'Chemistry question'})).toBeEditable();
  });
  if(results.some(r=>r.status!=='passed'||r.pageErrors.length))process.exitCode=1;
}finally{await instance.close();}
