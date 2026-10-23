const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddy', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  action: (name, arg) => ipcRenderer.invoke('settings:action', name, arg),
  onChanged: (cb) => ipcRenderer.on('changed', () => cb()),
});
