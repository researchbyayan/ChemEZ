const {test} = require('node:test');
const assert = require('node:assert/strict');
const {windowStyle} = require('./window-style.cjs');
test('Windows 10 and pre-22H2 Windows 11 reveal the desktop through alpha',()=>{
  for(const version of ['10.0.19045','10.0.22000']) assert.deepEqual(windowStyle('win32',version),{transparent:true});
});
test('Windows 11 22H2 and newer use native acrylic without conflicting transparency',()=>{
  for(const version of ['10.0.22621','10.0.26100']) assert.deepEqual(windowStyle('win32',version),{transparent:false,backgroundMaterial:'acrylic'});
});
test('macOS keeps native vibrancy',()=>assert.equal(windowStyle('darwin','24.0.0').vibrancy,'under-window'));
