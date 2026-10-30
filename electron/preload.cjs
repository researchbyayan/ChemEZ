const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('chemez', {
  appInfo: () => ipcRenderer.invoke('chemez:app-info'),
  credits: () => ipcRenderer.invoke('chemez:credits'),
  license: id => ipcRenderer.invoke('chemez:license',id),
  openCreditSource: id => ipcRenderer.invoke('chemez:credit-source',id),
  checkUpdates: () => ipcRenderer.invoke('chemez:updates'),
  downloadUpdate: () => ipcRenderer.invoke('chemez:update-download'),
  installUpdate: () => ipcRenderer.invoke('chemez:update-install'),
  onUpdate: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('chemez:update', listener);
    return () => ipcRenderer.removeListener('chemez:update', listener);
  },
  request: (command, payload) => ipcRenderer.invoke('chemez:request', command, payload),
  chat: (payload) => ipcRenderer.invoke('chemez:chat', payload),
  cancel: () => ipcRenderer.invoke('chemez:cancel'),
  appearance: () => ipcRenderer.invoke('chemez:appearance'),
  windowAction: action => ipcRenderer.invoke('chemez:window', action),
  pickImage: () => ipcRenderer.invoke('chemez:pick-image'),
  saveImage: (payload) => ipcRenderer.invoke('chemez:save-image', payload),
  saveText: text => ipcRenderer.invoke('chemez:save-text', text),
  openReference: url => ipcRenderer.invoke('chemez:open-reference', url),
  openLink: url => ipcRenderer.invoke('chemez:open-link', url),
  signInOpenRouter: () => ipcRenderer.invoke('chemez:openrouter-signin'),
  onBackdrop: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('chemez:backdrop', listener);
    return () => ipcRenderer.removeListener('chemez:backdrop', listener);
  },
  onEvent: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('chemez:event', listener);
    return () => ipcRenderer.removeListener('chemez:event', listener);
  }
});
