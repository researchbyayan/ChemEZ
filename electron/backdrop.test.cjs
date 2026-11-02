const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');

test('overlapping backdrop checks share one task and a closed window receives no updates',async()=>{
  const window=new EventEmitter();window.webContents=new EventEmitter();
  window.isDestroyed=()=>false;window.getBounds=()=>({x:0,y:0,width:800,height:600});
  let calls=0,release,tick,cleared=false;const sent=[];
  const context={module:{exports:{}},process:{platform:'darwin'},setTimeout:()=>1,clearTimeout:()=>{},setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>{cleared=true;},require:name=>{
    if(name==='node:child_process')return {execFile:(file,args,options,callback)=>{calls++;if(file.includes('osascript'))release=callback;else callback(null,'');}};
    if(name==='electron')return {nativeImage:{createFromPath:()=>({isEmpty:()=>false,toBitmap:()=>Buffer.alloc(48*48*4)})},screen:{getDisplayMatching:()=>({bounds:{x:0,y:0,width:1000,height:800}})}};
    return require(name);
  }};
  vm.runInNewContext(readFileSync(require.resolve('./backdrop.cjs'),'utf8'),context);
  context.module.exports.watchBackdrop(window,value=>sent.push(value));
  window.webContents.emit('did-finish-load');window.webContents.emit('did-finish-load');tick();
  assert.equal(calls,1);
  window.emit('closed');release(null,'/tmp/example-wallpaper.jpg');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,2); // One wallpaper lookup, then one image conversion.
  assert.equal(sent.length,0);assert.equal(cleared,true);
  tick();assert.equal(calls,2);
});
