import {_electron as electron,expect} from '@playwright/test';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {root,python} from './python-path.mjs';

const directory=path.join(root,'evaluation','runs','final-replay-2026-10-26');
const report=JSON.parse(await readFile(path.join(directory,'results.json'),'utf8'));
const profile=await mkdtemp(path.join(os.tmpdir(),'ChemEZ live-answer replay '));
const seeded=spawnSync(python,['-c',`import json,sys,pathlib
sys.path.insert(0,str(pathlib.Path(sys.argv[1])/'backend'))
from chemez.storage import Store
store=Store(pathlib.Path(sys.argv[2]))
store.save_config({'provider':'compatible','model':'Live NVIDIA output replay','endpoint':'http://127.0.0.1:9/v1','auth_mode':'none'})
report=json.loads(pathlib.Path(sys.argv[3]).read_text())
for item in report['results']:
 cid=store.create(item['id']+' · '+item['prompt'])
 store.add(cid,'user',{'text':item['prompt'],'images':[]})
 store.add(cid,'assistant',item['blocks'],response_style=item['mode'])`,root,profile,path.join(directory,'results.json')],{encoding:'utf8'});
if(seeded.status!==0)throw new Error(seeded.stderr);
const app=await electron.launch({args:[path.join(root,'electron','main.cjs')],env:{...process.env,CHEMEZ_PROFILE:profile,CHEMEZ_SESSION_ONLY:'1'},timeout:60000});
const page=await app.firstWindow();const errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('crash',()=>errors.push('Renderer crashed'));
try{
 await expect(page.getByRole('button',{name:/^K01 ·/})).toBeVisible({timeout:60000});
 for(const item of report.results){
  const start=errors.length;
  await page.getByRole('button',{name:new RegExp('^'+item.id+' ·')}).first().click();
  await expect(page.locator('.message.assistant')).toHaveCount(1);
  await page.locator('.answer-flow').waitFor();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('.message.assistant img')).every(image=>image.complete&&image.naturalWidth>0));
  const scroll=page.locator('.conversation-scroll');
  const size=await scroll.evaluate(el=>({height:el.clientHeight,total:el.scrollHeight}));
  const count=Math.min(8,Math.max(1,Math.ceil(size.total/size.height)));
  item.screenshots=[];
  for(let i=0;i<count;i++){
   await scroll.evaluate((el,top)=>el.scrollTop=top,i*size.height);
   const file=`${item.id}-${i+1}.png`;
   await page.screenshot({path:path.join(directory,file)});item.screenshots.push(file);
  }
  item.render={pageErrors:errors.slice(start),katexErrors:await page.locator('.katex-error').count(),images:await page.locator('.message.assistant img').count(),brokenImages:await page.locator('.message.assistant img').evaluateAll(images=>images.filter(i=>!i.complete||!i.naturalWidth).length)};
  console.log(item.id,item.validation_status,'screenshots',count,'render errors',item.render.pageErrors.length,'math errors',item.render.katexErrors);
  await writeFile(path.join(directory,'results.json'),JSON.stringify(report,null,2));
 }
}finally{await app.close();}
