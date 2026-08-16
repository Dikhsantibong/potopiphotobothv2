const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  restartApp: () => ipcRenderer.send('restart-app'),
  closeApp: () => ipcRenderer.send('close-app'),
  
  // Versi aplikasi yang sedang berjalan
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Auto Updater
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  downloadUpdate: () => ipcRenderer.send('download-update'),
  installUpdate: () => ipcRenderer.send('install-update'),
  
  // Listeners
  onUpdateAvailable: (callback) => {
    ipcRenderer.removeAllListeners('update-available');
    ipcRenderer.on('update-available', (_, info) => callback(info));
  },
  onUpdateNotAvailable: (callback) => {
    ipcRenderer.removeAllListeners('update-not-available');
    ipcRenderer.on('update-not-available', (_, info) => callback(info));
  },
  onUpdateError: (callback) => {
    ipcRenderer.removeAllListeners('update-error');
    ipcRenderer.on('update-error', (_, error) => callback(error));
  },
  onDownloadProgress: (callback) => {
    ipcRenderer.removeAllListeners('download-progress');
    ipcRenderer.on('download-progress', (_, progressObj) => callback(progressObj));
  },
  onUpdateDownloaded: (callback) => {
    ipcRenderer.removeAllListeners('update-downloaded');
    ipcRenderer.on('update-downloaded', (_, info) => callback(info));
  },
});

// ── Camera Layer (provider-agnostic) ──────────────────────────
// Renderer tidak pernah bicara HTTP langsung ke digiCamControl.
contextBridge.exposeInMainWorld('camera', {
  healthCheck: () => ipcRenderer.invoke('camera:healthCheck'),
  getStatus: () => ipcRenderer.invoke('camera:getStatus'),
  startLiveView: () => ipcRenderer.invoke('camera:startLiveView'),
  stopLiveView: () => ipcRenderer.invoke('camera:stopLiveView'),
  capture: () => ipcRenderer.invoke('camera:capture'),

  // Alur jepret terpisah: arm saat countdown mulai, fire tepat di akhir
  // countdown, collect setelahnya.
  armCapture: () => ipcRenderer.invoke('camera:armCapture'),
  fireShutter: () => ipcRenderer.invoke('camera:fireShutter'),
  collectPhoto: () => ipcRenderer.invoke('camera:collectPhoto'),
  getShutterCommand: () => ipcRenderer.invoke('camera:getShutterCommand'),
  setShutterCommand: (value) => ipcRenderer.invoke('camera:setShutterCommand', value),
  getFrame: () => ipcRenderer.invoke('camera:getFrame'),
  getLastCaptured: () => ipcRenderer.invoke('camera:getLastCaptured'),
  downloadPhoto: (filename) => ipcRenderer.invoke('camera:downloadPhoto', filename),

  // Toggle provider
  getProvider: () => ipcRenderer.invoke('camera:getProvider'),
  setProvider: (name) => ipcRenderer.invoke('camera:setProvider', name),
  onProviderChanged: (callback) => {
    ipcRenderer.removeAllListeners('camera:providerChanged');
    ipcRenderer.on('camera:providerChanged', (_, status) => callback(status));
  },

  // Kunci perpindahan provider selama sesi photobooth berjalan
  setSessionActive: (active) => ipcRenderer.invoke('camera:setSessionActive', active),

  // Ukuran JPEG yang diminta ke kamera (digiCamControl saja)
  getImageQuality: () => ipcRenderer.invoke('camera:getImageQuality'),
  setImageQuality: (value) => ipcRenderer.invoke('camera:setImageQuality', value),

  // Jembatan agar Main bisa menyuruh renderer menghentikan MediaStream webcam.
  // getUserMedia hanya ada di renderer, jadi Main tidak bisa melakukannya sendiri.
  onWebcamRequest: (callback) => {
    ipcRenderer.removeAllListeners('camera:webcam-request');
    ipcRenderer.on('camera:webcam-request', (_, payload) => callback(payload));
  },
  respondWebcam: (payload) => ipcRenderer.send('camera:webcam-response', payload),
});
