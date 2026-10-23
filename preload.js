const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  getState: () => ipcRenderer.invoke('get-state'),
  character: () => ipcRenderer.invoke('character'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  onSettings: (cb) => ipcRenderer.on('settings', (_e, s) => cb(s)),
  trayIcon: (dataUrl) => ipcRenderer.send('tray-icon', dataUrl),
  onEffect: (cb) => ipcRenderer.on('effect', (_e, name) => cb(name)),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  answer: (id, answer) => ipcRenderer.send('answer', { id, answer }),
  lingerEnd: (sid) => ipcRenderer.send('linger-end', sid),
  markRead: (sid) => ipcRenderer.send('mark-read', sid),
  openSession: (sid) => ipcRenderer.send('open-session', sid),
  focusClaude: () => ipcRenderer.send('focus-claude'),
  showMenu: () => ipcRenderer.send('show-menu'),
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  drag: (phase, x, y) => ipcRenderer.send('drag', { phase, x, y }),
});
