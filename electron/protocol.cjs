'use strict';
// Shared by the isolated preload and main process. There is no arbitrary fetch IPC.
const routes = Object.freeze({
  saveVisionConfig: ['PUT','/config/vision'], deleteVisionConfig: ['DELETE','/config/vision'], testVisionConnection: ['POST','/config/vision/test'],
  loadModels: ['POST','/config/models'], getConfig: ['GET','/config'], saveConfig: ['PUT','/config'],
  deleteKey: ['DELETE','/credentials'], testConnection: ['POST','/config/test'],
  listConversations: ['GET','/conversations'],
  listDiagrams: ['GET','/diagrams'], structure3d: ['POST','/structure/3d'], analyseStructure: ['POST','/structure/analysis'],
  getConversation: ['GET','/conversations/'], deleteConversation: ['DELETE','/conversations/']
});
function resolveRoute(command, payload) {
  if (command === 'searchConversations') {
    if (typeof payload !== 'string' || payload.length > 200) throw new Error('Invalid search query.');
    return ['GET','/conversations/search?q='+encodeURIComponent(payload)];
  }
  if (command === 'rewindConversation') {
    if (!payload || !/^[a-f0-9-]{36}$/.test(payload.id) || !/^[a-f0-9-]{36}$/.test(payload.before_message_id)) throw new Error('Invalid retry request.');
    return ['POST','/conversations/'+payload.id+'/rewind'];
  }
  if (command === 'suggestQuestion') {
    if (!payload || !/^[a-f0-9-]{36}$/.test(payload.id) || !['concise','balanced','mechanism'].includes(payload.mode) || (payload.command && !/^[a-z]{2,20}$/.test(payload.command))) throw new Error('Invalid suggestion request.');
    return ['POST','/conversations/'+payload.id+'/suggest'];
  }
  if (command === 'updateConversation') {
    if (!payload || typeof payload.id !== 'string' || !/^[a-f0-9-]{36}$/.test(payload.id) || typeof payload.title !== 'string' || !payload.title.trim() || payload.title.length > 80 || typeof payload.pinned !== 'boolean') throw new Error('Invalid conversation update.');
    return ['PATCH','/conversations/' + payload.id];
  }
  if ((command === 'structure3d' || command === 'analyseStructure') && (!payload || typeof payload.smiles !== 'string' || !payload.smiles || payload.smiles.length > 2000)) throw new Error('Invalid structure request.');
  const route = routes[command];
  if (!route) throw new Error('Unsupported desktop command.');
  if (command === 'getConversation' || command === 'deleteConversation') {
    if (typeof payload !== 'string' || !/^[a-f0-9-]{36}$/.test(payload)) throw new Error('Invalid conversation ID.');
    return [route[0], route[1] + payload];
  }
  return route;
}
module.exports = { resolveRoute };
