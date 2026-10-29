const {test}=require('node:test');
const assert=require('node:assert/strict');
const {resolveRoute}=require('./protocol.cjs');
test('IPC only permits explicit routes and valid conversation IDs',()=>{
  assert.deepEqual(resolveRoute('getConfig'),['GET','/config']);
  assert.throws(()=>resolveRoute('arbitraryFetch'));
  assert.throws(()=>resolveRoute('getConversation','../../credentials'));
  assert.throws(()=>resolveRoute('rewindConversation',{id:'../../credentials',before_message_id:'bad'}));
  assert.deepEqual(resolveRoute('searchConversations','C# + O'),['GET','/conversations/search?q=C%23%20%2B%20O']);
  assert.throws(()=>resolveRoute('updateConversation',{id:'../../credentials',title:'Name',pinned:true}));
  assert.deepEqual(resolveRoute('updateConversation',{id:'12345678-1234-1234-1234-123456789abc',title:'Name',pinned:true}),['PATCH','/conversations/12345678-1234-1234-1234-123456789abc']);
  assert.deepEqual(resolveRoute('getConversation','12345678-1234-1234-1234-123456789abc'),['GET','/conversations/12345678-1234-1234-1234-123456789abc']);
});
test('3D structure requests carry only a bounded SMILES string',()=>{
  assert.deepEqual(resolveRoute('structure3d',{smiles:'CCO'}),['POST','/structure/3d']);
  assert.throws(()=>resolveRoute('structure3d',{smiles:'C'.repeat(2001)}));
  assert.throws(()=>resolveRoute('structure3d','CCO'));
});
