import {_electron as electron,expect} from '@playwright/test';
import {mkdtemp,rm,mkdir,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {root} from './python-path.mjs';
const packaged=process.argv.includes('--packaged');
const localOllama=process.argv.includes('--local-ollama');
const profile=await mkdtemp(path.join(os.tmpdir(),'ChemEZ electron profile '));
const answer={blocks:[
  {type:'markdown',text:'Ethanol has formula $\\ce{C2H6O}$.\n\n$$\n\\ce{CH3CH2OH + 3O2 -> 2CO2 + 3H2O}\n$$'},
  {type:'molecule',smiles:'CCO',label:'Ethanol',formula:'C2H6O'},
  {type:'reaction',reactants:[{smiles:'CCO'},{smiles:'CC(=O)O'}],products:[{smiles:'CCOC(C)=O'},{smiles:'O'}],reagents:'H2SO4',conditions:'Heat',caption:'Esterification'},
  {type:'mechanism',steps:[{smiles:'[OH-].CBr',label:'SN2 attack',arrows:[{tail:[0],head:[1],electrons:2,bend:1},{tail:[1,2],head:[2],electrons:2,bend:-1}],limitation:''}]}
]};
answer.blocks.push(
  {type:'markdown',text:'Benzene has two equivalent Kekulé contributors, representing one delocalized aromatic molecule.'},
  {type:'molecule',smiles:'C1=CC=CC=C1',label:'Benzene contributor I',formula:'C6H6'},
  {type:'molecule',smiles:'C1C=CC=CC=1',label:'Benzene contributor II',formula:'C6H6'}
);
let providerCalls=0;
let styledAnswerSeen=false;
let rejectedCalls=0;
const gatewayRetry=process.argv.includes('--gateway-retry');
const server=createServer((request,response)=>{
  let body='';request.on('data',chunk=>body+=chunk);request.on('end',()=>{
    if(localOllama&&request.url==='/api/version'){response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({version:'test'}));return;}
    if(localOllama&&request.url==='/api/tags'){response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({models:[{name:'smoke-model'}]}));return;}
    if(!localOllama&&request.headers.authorization!=='Bearer smoke-test-key'){response.writeHead(401);response.end();return;}
    if(request.url==='/v1/models'){response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({data:[{id:'smoke-model'}]}));return;}
    if(gatewayRetry&&rejectedCalls===0){rejectedCalls++;response.writeHead(503,{'Retry-After':'0'});response.end();return;}
    providerCalls++;
    if(body.includes('Answer style:'))styledAnswerSeen=true;
    response.writeHead(200,{'Content-Type':'text/event-stream'});
    response.write('data: '+JSON.stringify({choices:[{delta:{content:'Here is the formatted answer:\n```json\n'+JSON.stringify(answer)+'\n```'}}]})+'\n\n');
    response.end('data: [DONE]\n\n');
  });
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(localOllama?11434:0,'127.0.0.1',resolve);});
const endpoint=`http://127.0.0.1:${server.address().port}/v1`;
let executablePath;
if(packaged){executablePath=process.env.CHEMEZ_ELECTRON_EXE||path.join(root,'release',process.platform==='darwin'?(process.arch==='arm64'?'mac-arm64':'mac')+'/ChemEZ.app/Contents/MacOS/ChemEZ':process.platform==='win32'?'win-unpacked/ChemEZ.exe':'linux-unpacked/chemez');}
const args=packaged?[]:[path.join(root,'electron','main.cjs')];
if(process.argv.includes('--no-sandbox'))args.push('--no-sandbox');
let instance;
try{
  instance=await electron.launch({executablePath,args,env:{...process.env,CHEMEZ_PROFILE:profile,CHEMEZ_SESSION_ONLY:'1'},timeout:60000});
  const page=await instance.firstWindow();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await expect(page.getByRole('heading',{name:/Chemistry, clearer/})).toBeVisible();
  const canvas=await page.locator('html').evaluate(element=>({scheme:getComputedStyle(element).colorScheme,background:getComputedStyle(element).backgroundColor}));
  if(canvas.scheme!=='normal'||canvas.background!=='rgba(0, 0, 0, 0)')throw new Error('The browser canvas is opaque.');
  await page.screenshot({path:path.join(root,'test-results','packaged-glass-welcome.png'),omitBackground:true});
  const dragRegion=await page.locator('.topbar').evaluate(element=>getComputedStyle(element).webkitAppRegion);
  if(dragRegion!=='drag')throw new Error('The title bar is not draggable.');
  // Xvfb has no window manager, so maximize state cannot change there. Native
  // window controls are exercised on macOS and Windows runners.
  if(process.platform!=='linux'){
    await page.evaluate(()=>window.chemez.windowAction('toggle-maximize'));
    await expect.poll(()=>instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]?.isMaximized())).toBe(true);
    // AppKit reports the zoom state before its resize animation settles.
    if(process.platform==='darwin')await new Promise(resolve=>setTimeout(resolve,450));
    await page.evaluate(()=>window.chemez.windowAction('toggle-maximize'));
    await expect.poll(()=>instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]?.isMaximized())).toBe(false);
  }
  // A fresh profile is asked for its chemistry level first.
  const welcome=page.getByRole('dialog',{name:'Welcome to ChemEZ'});
  if(await welcome.isVisible().catch(()=>false)||await welcome.waitFor({timeout:5000}).then(()=>true,()=>false))await welcome.getByRole('radio',{name:/University/}).click();
  await page.getByRole('button',{name:/Model settings/}).click();
  await expect(page.getByRole('heading',{name:'Model & API'})).toBeVisible();
  await page.getByRole('radio',{name:localOllama?/Ollama/:/Custom/}).click();
  if(localOllama){await expect(page.getByLabel('API key',{exact:true})).toHaveCount(0);}
  else{await page.getByLabel('API base URL').fill(endpoint);await page.getByLabel('API key',{exact:true}).fill('smoke-test-key');}
  await expect(page.getByLabel('Model',{exact:true})).toBeVisible({timeout:30000});
  await page.getByLabel('Model',{exact:true}).selectOption('smoke-model');
  await page.getByRole('button',{name:'Save & connect'}).click();
  await expect(page.getByText('Connected. You’re ready to chat.')).toBeVisible({timeout:30000});
  await page.getByRole('button',{name:'Start chatting'}).click();
  await page.getByRole('textbox',{name:'Chemistry question'}).fill('Draw ethanol and show a reaction and mechanism.');
  await page.getByRole('button',{name:'Send question'}).click();
  await expect(page.getByRole('img',{name:'Ethanol molecular structure',exact:true})).toBeVisible({timeout:30000});
  await expect(page.getByRole('group',{name:'Esterification'})).toBeVisible();
  const participant=page.getByRole('group',{name:'Esterification'}).locator('.structure-trigger').first();
  await participant.hover();
  await expect(page.getByRole('dialog',{name:'ethanol molecular structure details'})).toContainText('C2H6O');
  await page.keyboard.press('Escape');
  await participant.focus();
  await expect(page.getByRole('dialog',{name:'ethanol molecular structure details'}).getByRole('button',{name:'Save PNG',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(()=>document.documentElement.dataset.diagramLayout='scroll');
  await participant.focus();
  await expect(page.getByRole('dialog',{name:'ethanol molecular structure details'})).toBeVisible();
  if(!await page.locator('body > .structure-popover').count())throw new Error('Structure dropdown must escape reaction overflow.');
  await page.keyboard.press('Escape');
  await page.evaluate(()=>document.documentElement.dataset.diagramLayout='wrap');

  await expect(page.getByRole('img',{name:'SN2 attack'})).toBeVisible();
  await expect(page.getByRole('img',{name:'Benzene contributor I molecular structure',exact:true})).toBeVisible();
  await expect(page.getByRole('img',{name:'Benzene contributor II molecular structure',exact:true})).toBeVisible();
  await expect(page.locator('.katex-display')).toBeVisible();
  await expect(page.locator('.katex-error')).toHaveCount(0);
  const encoding=await page.evaluate(async()=>{const conversations=await window.chemez.request('listConversations');const conversation=await window.chemez.request('getConversation',conversations[0].id);return conversation.messages[1].content.find(block=>block.type==='molecule').encoding;});
  if(!encoding.available||encoding.shape[0]!==150)throw new Error('Sequence diagnostics missing from saved molecule.');
  await expect(page.getByRole('button',{name:'Copy answer',exact:false})).toBeVisible();
  if(gatewayRetry&&rejectedCalls!==1)throw new Error('Transient gateway rejection was not exercised.');
  if(providerCalls<2)throw new Error(`Expected a connection check and a chemistry request; received ${providerCalls} provider calls.`);
  if(!styledAnswerSeen)throw new Error('Answer-style instructions did not reach the provider.');
  const pngFile=path.join(profile,'exported diagram.png');
  await instance.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},pngFile);
  await page.getByRole('button',{name:'Details for Ethanol molecular structure',exact:true}).hover();
  await page.getByRole('dialog',{name:'ethanol molecular structure details'}).getByRole('button',{name:'Save PNG',exact:true}).click();
  await expect.poll(async()=>{try{return (await readFile(pngFile)).subarray(1,4).toString();}catch{return '';}}).toBe('PNG');
  await page.getByRole('button',{name:/New conversation/}).click();
  await page.locator('.history-item > button').first().click();
  await expect(page.getByRole('img',{name:'Ethanol molecular structure',exact:true})).toBeVisible();
  const markdownFile=path.join(profile,'conversation.md');
  await instance.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},markdownFile);
  await page.getByRole('button',{name:'Export conversation'}).click();
  await expect.poll(async()=>{try{return await readFile(markdownFile,'utf8');}catch{return '';}}).toContain('## ChemEZ');
  await page.evaluate(async()=>{const chats=await window.chemez.request('listConversations');await window.chemez.request('updateConversation',{id:chats[0].id,title:'Pinned chemistry',pinned:true});const saved=await window.chemez.request('listConversations');if(saved[0].title!=='Pinned chemistry'||!saved[0].pinned)throw new Error('Chat metadata was not persisted.');});
  await page.evaluate(async()=>{
    const diagrams=await window.chemez.request('listDiagrams');
    if(!diagrams.some(item=>item.block.type==='molecule'&&item.block.smiles==='CCO'&&item.block.svg))throw new Error('Validated structures were missing from the library.');
    const chats=await window.chemez.request('listConversations');const id=chats[0].id;
    const original=await window.chemez.request('getConversation',id);
    if(!original.messages.some(message=>message.role==='assistant'))throw new Error('Saved answer did not restore.');
    await window.chemez.request('updateConversation',{id,title:chats[0].title,pinned:true,archived:true});
    const found=await window.chemez.request('searchConversations','Ethanol');
    if(!found.some(chat=>chat.id===id&&chat.archived&&chat.snippet))throw new Error('Full-text archived search failed.');
    await window.chemez.request('updateConversation',{id,title:chats[0].title,pinned:true,archived:false});
  });
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByRole('button',{name:'Structure library',exact:true}).click();
  await expect(page.getByRole('complementary',{name:'Structure library'}).locator('.structure-grid button').first()).toBeVisible();
  const isolation=await page.evaluate(()=>({node:typeof window.require,bridge:typeof window.chemez?.request}));
  if(isolation.node!=='undefined'||isolation.bridge!=='function')throw new Error('Renderer isolation/preload failed');
  if(errors.length)throw new Error(errors.join('\n'));
  await mkdir(path.join(root,'test-results'),{recursive:true});
  await page.screenshot({path:path.join(root,'test-results',packaged?'electron-packaged.png':'electron-development.png')});
  const db=await readFile(path.join(profile,'chemez.sqlite3'));
  if(db.includes(Buffer.from('smoke-test-key')))throw new Error('API key leaked into SQLite.');
  console.log('Electron smoke passed: native startup, real provider adapter, RDKit structures/reactions/mechanisms, seq_encode, math, PNG export, history, theme, and renderer isolation.');
}finally{
  if(instance)await instance.close();
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await rm(profile,{recursive:true,force:true});
}
