const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  restartApp: () => ipcRenderer.send('restart-app'),
  closeApp: () => ipcRenderer.send('close-app'),
});
