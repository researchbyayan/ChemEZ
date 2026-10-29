import {_electron as electron,expect,chromium} from '@playwright/test';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {root} from './python-path.mjs';

if(!process.argv.includes('--live'))throw new Error('Use --live to explicitly run against the selected NVIDIA API.');
const option=name=>process.argv.find(value=>value.startsWith(name+'='))?.slice(name.length+1);
const tag=option('--tag')||new Date().toISOString().replace(/[:.]/g,'-');
const directory=path.join(root,'evaluation','runs',tag);
await mkdir(directory,{recursive:true});
const profile=await mkdtemp(path.join(os.tmpdir(),'ChemEZ live evaluation '));
const selected=option('--cases')?.split(',');
const cases=JSON.parse(await readFile(option('--cases-file')?path.resolve(option('--cases-file')):path.join(root,'evaluation','cases.json'),'utf8')).filter(c=>!selected||selected.includes(c.id));
if(process.argv.includes('--with-images'))cases.push(
 {id:'V01',group:'vision',mode:'balanced',prompt:'Identify the molecule in this image, draw it, and give its molecular formula.',image_files:['ethanol.png'],terms:['C2H6O'],smiles:['CCO'],expected:'Ethanol, C2H6O, primary alcohol.'},
 {id:'V02',group:'vision',mode:'concise',prompt:'Read this structure and identify the aldehyde. Draw the exact compound shown.',image_files:['benzaldehyde.png'],terms:['C7H6O'],smiles:['O=Cc1ccccc1'],expected:'Benzaldehyde, not acetone or acetophenone.'},
 {id:'V03',group:'vision',mode:'tutor',prompt:'Identify the molecule and its functional groups in this image. Explain how the drawn groups distinguish it from salicylic acid.',image_files:['aspirin.png'],terms:['ester','acid'],smiles:['CC(=O)Oc1ccccc1C(=O)O'],expected:'Aspirin with ester and carboxylic acid, C9H8O4.'},
 {id:'V04',group:'vision',mode:'balanced',prompt:'Read this wedge-bond structure. Preserve its stereochemistry when redrawing it, or explicitly identify any uncertainty.',image_files:['chiral.png'],terms:[],smiles:['C[C@H](O)CC'],expected:'Preserve the stereocentre in pentan-2-ol; do not invent an opposite configuration.'},
 {id:'V05',group:'vision',mode:'concise',prompt:'This image has been rotated. Identify and redraw the molecule without changing its connectivity.',image_files:['rotated.png'],terms:['C2H6O'],smiles:['CCO'],expected:'The same ethanol connectivity despite rotation.'},
 {id:'V06',group:'vision',mode:'balanced',prompt:'What molecular structure can you actually read from this image? Do not invent one if the image is blank.',image_files:['blank.png'],terms:[],smiles:[],expected:'State that no readable structure is present; ask for a clearer image.'},
 {id:'V07',group:'vision',mode:'balanced',prompt:'Can you read the bonds and atom labels in this blurred image reliably? Explain uncertainty before attempting an identification.',image_files:['blurred.png'],terms:[],smiles:[],expected:'Acknowledge blur and avoid unsupported confidence.'},
 {id:'V08',group:'vision',mode:'tutor',prompt:'Compare these two structures. Name them, draw them side by side, and explain the difference between their oxygen-containing functional groups.',image_files:['ethanol.png','benzaldehyde.png'],terms:['alcohol','aldehyde'],smiles:['CCO','O=Cc1ccccc1'],expected:'Ethanol versus benzaldehyde with correct separate drawings.'},
 {id:'V09',group:'vision',mode:'tutor',prompt:'Read the buffer problem in this image and solve it using the given pKa. Show the substituted equation.',image_files:['worksheet.png'],terms:['4.76'],smiles:[],expected:'Equal acid/base concentrations give pH 4.76.'},
 {id:'V10',group:'vision',mode:'concise',prompt:'Identify this molecule, give its formula, and draw the structure. Treat the pixels as evidence, not the filename.',image_files:['anonymous-structure.png'],terms:['C7H6O'],smiles:['O=Cc1ccccc1'],expected:'Benzaldehyde is identified from the structure, with no filename clue.'}
);
const configRead=spawnSync(path.join(root,'.venv','bin','python'),['-c',`import json,sqlite3,pathlib
p=pathlib.Path.home()/'Library/Application Support/ChemEZ/chemez.sqlite3'
c=sqlite3.connect('file:'+str(p)+'?mode=ro',uri=True)
v=json.loads(c.execute('select value from settings where id=1').fetchone()[0]);v.pop('api_key',None);print(json.dumps(v))`],{encoding:'utf8'});
if(configRead.status!==0)throw new Error('Could not read the current provider configuration.');
const config=JSON.parse(configRead.stdout);
if(option('--model'))config.model=option('--model');
if(config.provider!=='compatible'||new URL(config.endpoint).hostname!=='integrate.api.nvidia.com')throw new Error('The current connection is not NVIDIA. Select NVIDIA in ChemEZ first.');
const environment={...process.env,CHEMEZ_PROFILE:profile,CHEMEZ_EVAL_CAPTURE:path.join(directory,'raw')};
if(process.argv.includes('--connect'))environment.CHEMEZ_SESSION_ONLY='1';
else{delete environment.CHEMEZ_SESSION_ONLY;environment.CHEMEZ_CREDENTIALS_FILE=path.join(os.homedir(),'Library','Application Support','ChemEZ','credentials.json');}
const packaged=process.argv.includes('--packaged');
let instance,browser;
if(option('--attach-profile')){
 const port=(await readFile(path.join(option('--attach-profile'),'DevToolsActivePort'),'utf8')).split('\n')[0];
 browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);
}else instance=await electron.launch({...(packaged?{executablePath:path.join(root,'release','mac','ChemEZ.app','Contents','MacOS','ChemEZ'),args:[]}:{args:[path.join(root,'electron','main.cjs')]}),env:environment,timeout:60000});
const page=instance?await instance.firstWindow():browser.contexts()[0].pages()[0];
const results=[],crashes=[],pageErrors=[];
let closing=false;
instance?.on('close',()=>{if(!closing)crashes.push({time:new Date().toISOString(),type:'application-closed'});});
page.on('crash',()=>crashes.push({time:new Date().toISOString(),type:'renderer-crash'}));
page.on('pageerror',error=>pageErrors.push(error.message));
const summary={kind:'live-nvidia',model:config.model,endpoint:config.endpoint,profile,started:new Date().toISOString(),results,crashes};
async function persist(){await writeFile(path.join(directory,'results.json'),JSON.stringify(summary,null,2));}
function flatten(blocks){return blocks.flatMap(b=>[b,...flatten(b.reactants||[]),...flatten(b.products||[]),...flatten(b.steps||[])]);}
async function screenshotAnswer(id){
  const files=[];
  const scroller=page.locator('.conversation-scroll');
  const dimensions=await scroller.evaluate(el=>({height:el.clientHeight,total:el.scrollHeight}));
  const count=Math.min(8,Math.max(1,Math.ceil(dimensions.total/dimensions.height)));
  for(let n=0;n<count;n++){
    await scroller.evaluate((el,top)=>{el.scrollTop=top;},n*dimensions.height);
    const file=`${id}-${n+1}.png`;
    await page.screenshot({path:path.join(directory,file),omitBackground:false});files.push(file);
  }
  return files;
}
try{
  await expect(page.getByRole('textbox',{name:'Chemistry question'})).toBeVisible({timeout:60000});
  // A fresh profile asks for the learner level first.
  const welcome=page.getByRole('dialog',{name:'Welcome to ChemEZ'});
  if(await welcome.waitFor({timeout:5000}).then(()=>true,()=>false))await welcome.getByRole('radio',{name:/University/}).click();
  await page.evaluate(async settings=>{await window.chemez.request('saveConfig',settings);},config);
  let state=await page.evaluate(()=>window.chemez.request('getConfig'));
  if(!state.ready&&process.argv.includes('--connect')){
    await page.reload();
    await page.getByRole('button',{name:/Model settings/}).click();
    await page.bringToFront();
    console.log('WAITING: reconnect the same NVIDIA key in the evaluation window; it will stay only in this test session.');
    const deadline=Date.now()+3000000;
    while(!state.ready&&Date.now()<deadline){
      await new Promise(resolve=>setTimeout(resolve,1000));
      state=await page.evaluate(()=>window.chemez.request('getConfig'));
    }
    if(await page.getByRole('button',{name:'Close settings'}).count())await page.getByRole('button',{name:'Close settings'}).click();
  }
  if(!state.ready)throw new Error('The NVIDIA key is session-only or unavailable to this isolated test app. Rerun with --connect to enter it in the test window.');
  if(state.config.model!==config.model)await page.evaluate(settings=>window.chemez.request('saveConfig',settings),config);
  await page.reload();
  await expect(page.getByRole('textbox',{name:'Chemistry question'})).toBeVisible();
  console.log(`LIVE NVIDIA: ${config.model}; ${cases.length} prompts; ${directory}`);
  for(const test of cases){
    const started=Date.now(),errorStart=pageErrors.length;
    let result={...test,started:new Date().toISOString(),status:'running'};
    try{
      await page.getByRole('button',{name:'New conversation',exact:true}).click();
      await page.getByRole('combobox',{name:'Answer style'}).selectOption(test.mode);
      await page.getByRole('textbox',{name:'Chemistry question'}).fill(test.prompt);
      if(test.image_files){
        const files=await Promise.all(test.image_files.map(async name=>({name,data:(await readFile(path.join(root,'evaluation','fixtures',name))).toString('base64')})));
        await page.evaluate(files=>{const transfer=new DataTransfer();for(const f of files)transfer.items.add(new File([Uint8Array.from(atob(f.data),c=>c.charCodeAt(0))],f.name,{type:'image/png'}));document.querySelector('.composer').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));},files);
        await expect(page.locator('.attachment')).toHaveCount(files.length);
      }
      await page.evaluate(()=>{window.__evaluationEvents=[];window.__evaluationUnsubscribe?.();window.__evaluationUnsubscribe=window.chemez.onEvent(e=>window.__evaluationEvents.push(e));});
      await page.getByRole('button',{name:'Send question',exact:true}).click();
      await page.waitForFunction(()=>window.__evaluationEvents.some(e=>e.type==='finished'),{},{timeout:570000});
      await page.waitForFunction(()=>!document.querySelector('[aria-label="Stop generation"]'),{},{timeout:10000});
      const events=await page.evaluate(()=>window.__evaluationEvents);
      const cid=events.find(e=>e.type==='start')?.conversation_id;
      const conversation=cid?await page.evaluate(id=>window.chemez.request('getConversation',id),cid):null;
      const blocks=conversation?.messages.filter(m=>m.role==='assistant').at(-1)?.content||[];
      const all=flatten(blocks),prose=blocks.filter(b=>b.type==='markdown').map(b=>b.text).join('\n');
      const combined=JSON.stringify(all).toLowerCase();
      const errors=all.filter(b=>b.type==='error').map(b=>b.text).concat(events.filter(e=>e.type==='error').map(e=>e.message));
      const observations={wordCount:prose.split(/\s+/).filter(Boolean).length,markdownBlocks:blocks.filter(b=>b.type==='markdown').length,molecules:all.filter(b=>b.svg&&b.smiles).length,reactions:blocks.filter(b=>b.type==='reaction').length,mechanisms:blocks.filter(b=>b.type==='mechanism').length,clarifications:blocks.filter(b=>b.type==='clarification').length,hasQuestion:/\?\s*$/.test(prose),katexErrors:await page.locator('.katex-error').count(),missingTerms:test.terms.filter(t=>!combined.includes(t.toLowerCase())),smiles:all.filter(b=>b.smiles).map(b=>b.smiles)};
      const screenshots=await screenshotAnswer(test.id);
      result={...result,status:errors.length?'answer-error':'completed',durationMs:Date.now()-started,conversation_id:cid,blocks,errors,observations,screenshots,pageErrors:pageErrors.slice(errorStart)};
    }catch(error){
      result={...result,status:page.isClosed()?'crashed':'test-error',durationMs:Date.now()-started,error:String(error),pageErrors:pageErrors.slice(errorStart)};
      if(!page.isClosed()){
        try{result.screenshots=await screenshotAnswer(test.id+'-failure');await page.evaluate(()=>window.chemez.cancel());}catch{}
      }
    }
    results.push(result);await persist();
    console.log(`${test.id} ${test.mode} ${result.status} ${Math.round(result.durationMs/1000)}s${result.errors?.length?' '+result.errors.join('; '):''}`);
    if(result.errors?.some(message=>/api key|insufficient balance|quota|rate limit/i.test(message))){summary.blocker='The live run stopped after an authentication/quota failure; remaining cases were not sent.';break;}
    if(page.isClosed())break;
  }
  summary.finished=new Date().toISOString();await persist();
}catch(error){summary.blocker=String(error);await persist();console.error(summary.blocker);process.exitCode=1;}
finally{
 closing=true;await persist();
 if(instance&&process.argv.includes('--keep-open')&&!page.isClosed()){
  console.log('Test window remains open for follow-up checks; no API key has been exported.');
  await new Promise(resolve=>{instance.once('close',resolve);process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
 }
 await instance?.close().catch(()=>{});await browser?.close().catch(()=>{});await persist();
}
