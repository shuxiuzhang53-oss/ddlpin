const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('sticky', {
  resizeTo: (dims) => ipcRenderer.send('resize-to', dims),
  quit: () => ipcRenderer.send('quit'),
});
