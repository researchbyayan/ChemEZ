// Weekly update prompt. Windows and Linux (AppImage) download in the background and install on
// restart through electron-updater. An unsigned Mac app cannot replace itself, so there the new
// DMG downloads in the background and opens for the learner to drag into Applications.
const fs=require('node:fs/promises');
const path=require('node:path');
const WEEK=7*24*3600e3;
function createUpdater({app,shell,releaseInfo,send,fetchImpl=fetch}){
 const file=path.join(app.getPath('userData'),'update-prompt.json');
 const native=process.platform==='win32'||(process.platform==='linux'&&!!process.env.APPIMAGE);
 let pending=null,busy=false,auto=null;
 if(native&&app.isPackaged){
  auto=require('electron-updater').autoUpdater;
  auto.autoDownload=false;auto.autoInstallOnAppQuit=true;
  auto.on('download-progress',p=>send({state:'downloading',version:pending?.version,percent:Math.round(p.percent)}));
  auto.on('update-downloaded',info=>{busy=false;send({state:'ready',version:info.version});});
  auto.on('error',()=>{if(busy){busy=false;send({state:'error',version:pending?.version});}});
 }
 async function lastShown(){try{return JSON.parse(await fs.readFile(file,'utf8')).at||0;}catch{return 0;}}
 async function check(){
  if(!app.isPackaged||pending||Date.now()-await lastShown()<WEEK)return;
  try{
   if(auto){const result=await auto.checkForUpdates();if(!result?.isUpdateAvailable)return;pending={version:result.updateInfo.version};}
   else{const result=await releaseInfo.updates();if(result.status!=='available')return;pending=result;}
   await fs.writeFile(file,JSON.stringify({at:Date.now(),version:pending.version}));
   send({state:'available',version:pending.version});
  }catch{}
 }
 async function downloadDmg(){
  const target=path.join(app.getPath('downloads'),path.basename(new URL(pending.url).pathname));
  const response=await fetchImpl(pending.url);
  if(!response.ok||!response.body)throw new Error('Download failed.');
  const handle=await fs.open(target,'w');let got=0,last=-1;
  try{for await(const chunk of response.body){await handle.write(chunk);got+=chunk.length;const percent=Math.floor(got*100/pending.size);if(percent!==last){last=percent;send({state:'downloading',version:pending.version,percent});}}}
  finally{await handle.close();}
  if(got!==pending.size)throw new Error('Incomplete download.');
  await shell.openPath(target);
  send({state:'opened',version:pending.version});
 }
 return {
  check,
  start(){setTimeout(check,10000).unref?.();setInterval(check,6*3600e3).unref?.();},
  async download(){
   if(!pending||busy)return;busy=true;send({state:'downloading',version:pending.version,percent:0});
   if(auto){auto.downloadUpdate().catch(()=>{});return;}
   try{await downloadDmg();}catch{send({state:'error',version:pending.version});}finally{busy=false;}
  },
  install(){auto?.quitAndInstall();}
 };
}
module.exports={createUpdater,WEEK};
