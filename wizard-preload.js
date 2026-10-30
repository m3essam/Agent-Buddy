const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wizard', {
  init: () => ipcRenderer.invoke('wizard:init'),
  pickVideo: () => ipcRenderer.invoke('wizard:pick-video'),
  save: (data) => ipcRenderer.invoke('wizard:save', data),
});
