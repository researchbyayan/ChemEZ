const { app, BrowserWindow, ipcMain, dialog, nativeTheme, nativeImage, screen, shell } = require('electron');
const { spawn } = require('node:child_process');
const { randomBytes, createHash } = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const { resolveRoute } = require('./protocol.cjs');
const { watchBackdrop } = require('./backdrop.cjs');
const {windowStyle} = require('./window-style.cjs');
let window, child, baseURL, activeRequest, backendReady, stopping = false;
let recentRestarts = [];
const token = randomBytes(32).toString('hex');
const root = path.join(__dirname, '..');
if (process.env.CHEMEZ_PROFILE) app.setPath('userData', path.resolve(process.env.CHEMEZ_PROFILE));
const dev = !app.isPackaged && process.env.CHEMEZ_DEV === '1';
function launchBackend() {
  return new Promise((resolve, reject) => {
    const executable = app.isPackaged
      ? path.join(process.resourcesPath, 'backend', process.platform === 'win32' ? 'chemez-backend.exe' : 'chemez-backend')
      : process.env.CHEMEZ_PYTHON || path.join(root,'.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const service = child = spawn(executable, app.isPackaged ? [] : [path.join(root,'backend','run.py')], {
      env: {...process.env, ...(process.env.CHEMEZ_PROFILE?{}:{CHEMEZ_EVAL_CAPTURE:''}), CHEMEZ_TOKEN:token, CHEMEZ_DATA_DIR:app.getPath('userData'), PYTHONUNBUFFERED:'1'},
      stdio:['ignore','pipe','pipe'], windowsHide:true
    });
    let ready = false;
    const timeout = setTimeout(() => { service.kill(); reject(new Error('The chemistry backend did not start within 60 seconds.')); },60000);
    let output = '';
    service.stdout.on('data', chunk => {
      output += chunk.toString();
      let newline;
      while ((newline = output.indexOf('\n')) !== -1) {
        const line = output.slice(0,newline); output = output.slice(newline+1);
        try {
          const data = JSON.parse(line);
          if (data.ready && Number.isInteger(data.port) && data.port > 0 && data.port < 65536) {
            baseURL = `http://127.0.0.1:${data.port}`; ready = true; clearTimeout(timeout); resolve();
          }
        } catch { /* Non-protocol output is ignored. */ }
      }
    });
    // RDKit/encoder diagnostics go to stderr; do not forward user structures to logs.
    service.stderr.on('data', () => {});
    service.on('error', error => {clearTimeout(timeout); reject(error);});
    service.on('exit', () => {
      clearTimeout(timeout);
      if (!ready) reject(new Error('The chemistry backend exited during startup. Run npm run setup.'));
      else if (!stopping) {
        activeRequest?.abort();
        baseURL = undefined;
        recentRestarts = recentRestarts.filter(time=>Date.now()-time<60000);
        if (recentRestarts.length < 2) {
          recentRestarts.push(Date.now());
          backendReady = startBackend();
          backendReady.then(()=>window?.webContents.send('chemez:event',{type:'error',message:'The local chemistry service restarted after a failure. Your saved chats are safe. Retry the question; session-only API keys may need reconnecting.'})).catch(()=>window?.webContents.send('chemez:event',{type:'error',message:'The local chemistry service could not restart. Reopen ChemEZ to reconnect; your saved chats are safe.'}));
        } else {
          backendReady = Promise.reject(new Error('The chemistry service stopped repeatedly. Reopen ChemEZ to reconnect.'));
          backendReady.catch(()=>{});
          window?.webContents.send('chemez:event',{type:'error',message:'The chemistry service stopped repeatedly. Reopen ChemEZ to reconnect; your saved chats are safe.'});
        }
      }
    });
  });
}
async function startBackend() {
  await launchBackend();
  for(let attempt=0;attempt<100;attempt++){
    try{const response=await fetch(baseURL+'/health',{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(2000)});if(response.ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('The chemistry service failed its startup health check.');
}
async function callBackend(method, route, body, signal) {
  await backendReady;
  // Startup readiness line is emitted just before uvicorn enters its loop.
  const response = await fetch(baseURL+route, {
    method, headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:body === undefined ? undefined : JSON.stringify(body), signal
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data.detail === 'string' ? data.detail : response.status===422 ? 'The question or attachment could not be accepted. Use a shorter question and supported images.' : `Request failed (${response.status}).`);
  }
  return response;
}
function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted IPC sender.');
}
ipcMain.handle('chemez:request', async (event, command, payload) => {
  trusted(event);
  const [method, route] = resolveRoute(command,payload);
  const body = command === 'rewindConversation' ? {before_message_id:payload.before_message_id} : command === 'suggestQuestion' ? {mode:payload.mode,command:payload.command||''} : command === 'updateConversation' ? {title:payload.title,pinned:payload.pinned,...(typeof payload.archived==='boolean'?{archived:payload.archived}:{})} : ['structure3d','analyseStructure'].includes(command) ? {smiles:payload.smiles} : ['saveConfig','saveVisionConfig','loadModels'].includes(command) ? payload : undefined;
  return (await callBackend(method, route, body)).json();
});
ipcMain.handle('chemez:chat', async (event,payload) => {
  trusted(event);
  if (activeRequest) throw new Error('An answer is already in progress.');
  if (payload?.command != null && !['versus','stepbystep','synthesis','practice','nomenclature','lab','calc','spectra'].includes(payload.command)) throw new Error('Invalid selected command.');
  if (payload?.response_style !== undefined && !['balanced','concise','mechanism'].includes(payload.response_style)) throw new Error('Invalid answer style.');
  if (payload?.level !== undefined && !['school','undergraduate','graduate'].includes(payload.level)) throw new Error('Invalid learner level.');
  if (!payload || typeof payload.text !== 'string' || (!payload.text.trim() && !payload.images?.length) || payload.text.length > 12000 || !Array.isArray(payload.images) || payload.images.length > 4 || payload.images.some(image=>!image||image.mime!=='image/png'||typeof image.data!=='string'||image.data.length>8_000_000)) throw new Error('Enter a question or attach up to four supported images.');
  activeRequest = new AbortController();
  const send = value => { if (window && !window.isDestroyed()) window.webContents.send('chemez:event',value); };
  try {
    const response = await callBackend('POST','/chat',payload,activeRequest.signal);
    let buffer = '';
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk,{stream:true});
      if (buffer.length > 16_000_000) throw new Error('The answer diagram exceeded the display limit. Ask for fewer structures.');
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0,newline); buffer = buffer.slice(newline+1);
        if (line.trim()) send(JSON.parse(line));
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') send({type:'error',message:error.message});
  } finally {activeRequest = null; send({type:'finished'});}
});
// Links the app may open in the user's browser: email, and https on these sites only.
const LINK_HOSTS = ['github.com','linkedin.com','www.linkedin.com','scholar.google.com','openrouter.ai','build.nvidia.com','aistudio.google.com','platform.openai.com','console.anthropic.com','pubchem.ncbi.nlm.nih.gov'];
const releaseInfo=require('./release-info.cjs').createReleaseInfo({app,root});
ipcMain.handle('chemez:app-info',event=>{trusted(event);return releaseInfo.appInfo();});
ipcMain.handle('chemez:credits',event=>{trusted(event);return releaseInfo.credits();});
ipcMain.handle('chemez:license',(event,id)=>{trusted(event);return releaseInfo.license(id);});
ipcMain.handle('chemez:credit-source',async(event,id)=>{trusted(event);return shell.openExternal(await releaseInfo.source(id));});
ipcMain.handle('chemez:updates',event=>{trusted(event);return releaseInfo.updates();});
const updater=require('./updater.cjs').createUpdater({app,shell,releaseInfo,send:value=>{if(window&&!window.isDestroyed())window.webContents.send('chemez:update',value);}});
ipcMain.handle('chemez:update-download',event=>{trusted(event);return updater.download();});
ipcMain.handle('chemez:update-install',event=>{trusted(event);updater.install();});
ipcMain.handle('chemez:open-reference', (event, url) => {
  trusted(event);
  if(typeof url!=='string'||url.length>2000)return false;
  try {
    const target=new URL(url),host=target.hostname;
    if(target.protocol!=='https:'||target.username||target.password||!host.includes('.')||/^[\d.:\[\]]+$/.test(host)||host.endsWith('.local')||host.endsWith('.localhost'))return false;
    return shell.openExternal(target.href).then(()=>true);
  } catch {return false;}
});
ipcMain.handle('chemez:open-link', (event, url) => {
  trusted(event);
  const target = new URL(String(url));
  if (target.protocol === 'mailto:' || (target.protocol === 'https:' && LINK_HOSTS.includes(target.hostname))) return shell.openExternal(target.href).then(() => true);
  return false;
});
// Sign in with OpenRouter (OAuth PKCE): the browser approves, a one-off localhost listener
// receives the code, and the key goes straight from OpenRouter into ChemEZ's key store.
ipcMain.handle('chemez:openrouter-signin', async event => {
  trusted(event);
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('hex');
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname !== '/callback') { response.writeHead(404).end(); return; }
      const ok = url.searchParams.get('state') === state && url.searchParams.get('code');
      response.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}).end(`<!doctype html><title>ChemEZ</title><body style="font-family:-apple-system,sans-serif;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><p>${ok ? 'Signed in. You can close this tab and return to ChemEZ.' : 'Sign-in failed. Return to ChemEZ and try again.'}</p>`);
      clearTimeout(timer); server.close();
      ok ? resolve(url.searchParams.get('code')) : reject(new Error('OpenRouter sign-in was cancelled or did not match this request.'));
    });
    const timer = setTimeout(() => { server.close(); reject(new Error('OpenRouter sign-in timed out after 5 minutes.')); }, 300000);
    server.listen(0, '127.0.0.1', () => {
      const callback = `http://localhost:${server.address().port}/callback`;
      const auth = new URL('https://openrouter.ai/auth');
      auth.search = new URLSearchParams({callback_url:callback, code_challenge:challenge, code_challenge_method:'S256', state}).toString();
      shell.openExternal(auth.href).catch(reject);
    });
  });
  const exchange = await fetch('https://openrouter.ai/api/v1/auth/keys', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code, code_verifier:verifier, code_challenge_method:'S256'})});
  const data = await exchange.json().catch(() => ({}));
  if (!exchange.ok || typeof data.key !== 'string') throw new Error('OpenRouter did not issue a key. Try signing in again.');
  await callBackend('PUT', '/config', {provider:'compatible', endpoint:'https://openrouter.ai/api/v1', model:'auto', api_key:data.key});
  return (await callBackend('GET', '/config')).json();
});
ipcMain.handle('chemez:cancel', event => { trusted(event); activeRequest?.abort(); });
ipcMain.handle('chemez:appearance', event => {trusted(event);return {reducedTransparency:nativeTheme.prefersReducedTransparency};});
ipcMain.handle('chemez:window', (event, action) => {
  trusted(event);
  if (!['minimize','toggle-maximize','toggle-fullscreen','close','repaint'].includes(action)) throw new Error('Invalid window action.');
  // The transparent window can keep stale pixels where content disappeared (e.g. the welcome
  // screen behind a new chat), especially with GPU compositing off; repaint the whole page.
  if (action === 'repaint') window.webContents.invalidate();
  else if (action === 'minimize') window.minimize();
  else if (action === 'toggle-fullscreen') window.setFullScreen(!window.isFullScreen());
  else if (action === 'toggle-maximize') { if(window.isFullScreen()) window.setFullScreen(false); else window.isMaximized() ? window.unmaximize() : window.maximize(); }
  else window.close();
  return true;
});
ipcMain.handle('chemez:pick-image', async event => {
  trusted(event);
  const result = await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'Images',extensions:['png','jpg','jpeg','webp']}]});
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  const info = await fs.stat(filePath);
  if (info.size > 15 * 1024 * 1024) throw new Error('Choose an image smaller than 15 MB.');
  const {imageDimensions} = await import('../shared/image-input.mjs');
  imageDimensions(await fs.readFile(filePath));
  let image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) throw new Error('That file is not a readable PNG, JPEG, or WebP image.');
  const size = image.getSize();
  if (Math.max(size.width,size.height) > 1600) image = image.resize(size.width >= size.height ? {width:1600} : {height:1600},{quality:'better'});
  const data = image.toPNG().toString('base64');
  if (data.length > 8_000_000) throw new Error('The processed image is too large. Try a smaller image.');
  return {name:path.basename(filePath),mime:'image/png',data,dataUrl:`data:image/png;base64,${data}`};
});
ipcMain.handle('chemez:save-image', async (event, payload) => {
  trusted(event);
  if (!payload || !['svg','png'].includes(payload.format) || typeof payload.data !== 'string' || payload.data.length > 12000000) throw new Error('Invalid image export.');
  const {canceled,filePath} = await dialog.showSaveDialog(window,{defaultPath:`chemez-diagram.${payload.format}`,filters:[{name:payload.format.toUpperCase(),extensions:[payload.format]}]});
  if (canceled || !filePath) return false;
  await fs.writeFile(filePath,payload.format === 'svg' ? payload.data : Buffer.from(payload.data,'base64'));
  return true;
});
ipcMain.handle('chemez:save-text', async (event, text) => {
  trusted(event);
  if (typeof text !== 'string' || text.length > 10_000_000) throw new Error('Invalid conversation export.');
  const {canceled,filePath} = await dialog.showSaveDialog(window,{defaultPath:'chemez-conversation.md',filters:[{name:'Markdown',extensions:['md']}]});
  if (canceled || !filePath) return false;
  await fs.writeFile(filePath,text,'utf8');
  return true;
});
function createWindow() {
  const area=screen.getPrimaryDisplay().workAreaSize;
  // Select native acrylic only on supported Windows builds; older builds need alpha.
  window = new BrowserWindow({width:Math.min(1320,Math.max(840,area.width-40)),height:Math.min(900,Math.max(620,area.height-40)),minWidth:840,minHeight:620,frame:false,backgroundColor:'#00000000',...windowStyle(),title:'ChemEZ',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  if (process.platform === 'darwin') window.setVibrancy(nativeTheme.prefersReducedTransparency ? null : 'hud');
  window.setBackgroundColor('#00000000');
  window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  watchBackdrop(window, value => {if (!window.isDestroyed()) window.webContents.send('chemez:backdrop', value);});
  let lastRendererRecovery=0;
  window.webContents.on('render-process-gone',(_event,details)=>{
    if(stopping||details.reason==='clean-exit')return;
    activeRequest?.abort();
    if(Date.now()-lastRendererRecovery>60000){
      lastRendererRecovery=Date.now();
      setTimeout(()=>{if(window&&!window.isDestroyed())window.reload();},300);
    }else{
      dialog.showErrorBox('The chat view stopped','Your saved chats are safe. Reopen ChemEZ to reload the chat view.');
    }
  });
  window.webContents.on('will-navigate',(event,url) => {if (url !== window.webContents.getURL()) event.preventDefault();});
  if (dev) window.loadURL('http://127.0.0.1:5173'); else window.loadFile(path.join(root,'dist','index.html'));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance',() => {if(window){window.restore();window.focus();}});
  app.whenReady().then(() => {
    nativeTheme.themeSource='dark';
    // Paint the lightweight shell while Python warms up; IPC waits for health.
    backendReady=startBackend();
    createWindow();
    updater.start();
    backendReady.catch(error=>{dialog.showErrorBox('ChemEZ could not start',error.message);app.quit();});
    app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
  }).catch(error=>{dialog.showErrorBox('ChemEZ could not start',error.message);app.quit();});
  app.on('window-all-closed',() => app.quit());
  app.on('before-quit',() => {stopping=true;activeRequest?.abort();child?.kill();});
}
