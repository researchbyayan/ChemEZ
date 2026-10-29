import {_electron as electron,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {root,python} from './python-path.mjs';

const output=path.join(root,'evaluation','runs','recovery-2026-10-26');await mkdir(output,{recursive:true});
const profile=await mkdtemp(path.join(os.tmpdir(),'ChemEZ recovery tests '));
const answer=JSON.stringify({blocks:[{type:'markdown',text:'Ethanol is a primary alcohol.'},{type:'molecule',smiles:'CCO',label:'Ethanol',formula:'C2H6O'}]});
let requests=0;
const server=createServer((req,res)=>{
 let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
  requests++;
  if(body.includes('upstream-failure')){res.writeHead(500);res.end();return;}
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  if(body.includes('slow-answer')){res.write(': waiting\n\n');const timer=setTimeout(()=>res.end('data: [DONE]\n\n'),60000);res.on('close',()=>clearTimeout(timer));return;}
  const text=body.includes('truncated-answer')?'{"blocks":[{"type":"markdown","text":"unfinished':answer;
  res.end('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: [DONE]\n\n');
 });
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const app=await electron.launch({args:[path.join(root,'electron','main.cjs')],env:{...process.env,CHEMEZ_PROFILE:profile,CHEMEZ_SESSION_ONLY:'1'},timeout:60000});
const page=await app.firstWindow();const results=[];
async function snapshot(id){
 if(id==='R07'){
  const data=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await writeFile(path.join(output,id+'.png'),Buffer.from(data,'base64'));
 }else await page.screenshot({path:path.join(output,id+'.png')});
}
async function send(text){await page.getByRole('button',{name:'New conversation',exact:true}).click();await page.getByRole('textbox',{name:'Chemistry question'}).fill(text);await page.getByRole('button',{name:'Send question',exact:true}).click();}
async function test(id,title,fn){try{await fn();if(id!=='R07')await expect(page.getByRole('textbox',{name:'Chemistry question'})).toBeEditable();results.push({id,title,status:'passed'});}catch(e){results.push({id,title,status:'failed',error:String(e)});}await snapshot(id);await writeFile(path.join(output,'results.json'),JSON.stringify({kind:'native-controlled-failure-tests',results,requests},null,2));console.log(id,results.at(-1).status,title);}
try{
 await page.evaluate(async endpoint=>{await window.chemez.request('saveConfig',{provider:'compatible',model:'recovery',endpoint,auth_mode:'none'});},`http://127.0.0.1:${server.address().port}/v1`);
 await page.reload();await expect(page.getByRole('textbox',{name:'Chemistry question'})).toBeVisible();
 await test('R01','Malformed/truncated output is repaired once then remains a readable error',async()=>{
  const before=requests;await send('truncated-answer');await expect(page.getByRole('button',{name:'Stop generation'})).toHaveCount(0,{timeout:30000});await expect(page.getByRole('alert')).toContainText('valid structured answer');if(requests-before!==2)throw new Error('Malformed answer was not limited to one repair.');
 });
 await test('R02','Provider HTTP 500 does not close the application',async()=>{await send('upstream-failure');await expect(page.getByRole('alert')).toContainText('500',{timeout:15000});});
 await test('R03','Slow generation can be cancelled and the next answer succeeds',async()=>{
  await send('slow-answer');await expect(page.getByRole('button',{name:'Stop generation'})).toBeVisible();await page.getByRole('button',{name:'Stop generation'}).click();await expect(page.getByRole('button',{name:'Stop generation'})).toHaveCount(0);await send('healthy');await expect(page.getByRole('img',{name:/^ethanol molecular structure$/i})).toBeVisible({timeout:30000});
 });
 await test('R04','A corrupt saved answer is contained inside its render boundary',async()=>{
  const cid='11111111-1111-4111-8111-111111111111';
  const result=spawnSync(python,['-c',`import sqlite3,json,sys,pathlib
c=sqlite3.connect(pathlib.Path(sys.argv[1])/'chemez.sqlite3');cid=sys.argv[2]
c.execute('insert into conversations(id,title,updated) values(?,?,?)',(cid,'Corrupt saved answer','2026-10-26T00:00:00Z'))
c.execute('insert into messages(id,conversation_id,role,content,created) values(?,?,?,?,?)',('broken',cid,'assistant',json.dumps([{'id':'broken-block','type':'markdown','text':{'not':'text'}}]),'2026-10-26'))
c.commit()` ,profile,cid],{encoding:'utf8'});
  if(result.status!==0)throw new Error('Could not seed corrupt test-only history.');
  await page.reload();await page.getByRole('button',{name:'Corrupt saved answer',exact:true}).click();await expect(page.getByRole('alert')).toContainText('could not be displayed');
 });
 await test('R05','Native backend exit restarts the service without quitting the window',async()=>{
  const processes=spawnSync('/bin/ps',['-axo','pid=,ppid=,comm='],{encoding:'utf8'}).stdout;
  const pid=app.process().pid;
  const child=processes.split('\n').map(line=>line.trim().split(/\s+/)).find(parts=>Number(parts[1])===pid&&/python|chemez-backend/i.test(parts.slice(2).join(' ')));
  if(!child)throw new Error('Could not identify the isolated test backend process.');
  process.kill(Number(child[0]),'SIGKILL');
  await expect(page.getByRole('alert').filter({hasText:'service restarted'})).toBeVisible({timeout:30000});
  await send('healthy after restart');await expect(page.getByRole('img',{name:/^ethanol molecular structure$/i})).toBeVisible({timeout:30000});
 });
 await test('R06','Answer mode is persisted with the message through reload',async()=>{
  await page.getByRole('combobox',{name:'Answer style'}).selectOption('concise');await send('healthy mode persistence');await expect(page.getByRole('img',{name:/^ethanol molecular structure$/i})).toBeVisible({timeout:30000});
  await page.getByRole('button',{name:'Stop generation'}).waitFor({state:'hidden'});
  const saved=await page.evaluate(async()=>{const chats=await window.chemez.request('listConversations');return window.chemez.request('getConversation',chats[0].id);});
  if(saved.messages.at(-1).response_style!=='concise')throw new Error('Selected mode was not saved.');
  await page.reload();await page.getByRole('button',{name:'healthy mode persistence',exact:true}).click();await expect(page.locator('.answer-mode')).toHaveText('Quick answer');
 });
 await test('R08','Repeated structure explorer open/close releases its viewer and keeps local chemistry usable',async()=>{
  for(let i=0;i<4;i++){
   await page.locator('.structure-trigger').first().hover();
   await page.getByRole('button',{name:'Explore structure',exact:true}).click();
   const dialog=page.getByRole('dialog',{name:'Ethanol',exact:true});
   await expect(dialog).toBeVisible();
   await dialog.getByRole('tab',{name:'Functional groups',exact:true}).click();
   await expect(dialog.getByText('Alcohol',{exact:true})).toBeVisible({timeout:30000});
   await dialog.getByRole('tab',{name:'Properties',exact:true}).click();
   await expect(dialog.getByText('Molar mass',{exact:true})).toBeVisible({timeout:30000});
   await dialog.getByRole('button',{name:'Close Ethanol',exact:true}).click();
   await expect(dialog).toHaveCount(0);
  }
 });
 await test('R07','Renderer crash reloads the view and restores the active chat',async()=>{
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
  // Playwright marks the old renderer target as crashed. Query the recovered native
  // webContents rather than reusing that stale automation target.
  await expect.poll(async()=>{try{return await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('document.querySelector(".answer-mode")?.textContent'));}catch{return null;}},{timeout:30000}).toBe('Quick answer');
  const usable=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('!!document.querySelector("textarea:not([disabled])") && Array.from(document.querySelectorAll(".message.assistant img")).some(img => img.complete && img.naturalWidth > 0)'));
  if(!usable)throw new Error('The recovered renderer did not restore the answer and composer.');
 });
 if(results.some(r=>r.status!=='passed'))process.exitCode=1;
}finally{await app.close();server.close();}
