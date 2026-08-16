/**
 * Registrasi IPC untuk camera layer.
 *
 * Renderer (Next.js) TIDAK pernah melakukan HTTP request ke digiCamControl.
 * Semua lewat channel di bawah ini → CameraProviderManager → provider aktif.
 */
const path = require('path');
const { CameraProviderManager } = require('./CameraProviderManager');

/**
 * Lebar maksimum foto yang dikirim ke renderer.
 *
 * Canon EOS 200D menghasilkan JPEG 24 MP (~6–8 MB). Dikirim apa adanya, foto itu
 * membengkak +33% jadi base64, lalu renderer harus men-decode dan menggambarnya
 * ke canvas 6000×4000 sebelum toDataURL — beberapa detik hanya untuk satu frame.
 * 1920 px setara dengan yang dihasilkan jalur webcam existing, jadi kualitas
 * cetak tidak turun dibanding sebelum migrasi. File resolusi penuh tetap
 * tersimpan di folder sesi.
 */
const MAX_CAPTURE_WIDTH = 1920;
const CAPTURE_JPEG_QUALITY = 92;

function toDisplayJpeg(buffer) {
  try {
    const { nativeImage } = require('electron');
    let image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) return buffer;

    const size = image.getSize();
    if (size.width > MAX_CAPTURE_WIDTH) {
      image = image.resize({ width: MAX_CAPTURE_WIDTH, quality: 'good' });
    }

    const jpeg = image.toJPEG(CAPTURE_JPEG_QUALITY);
    if (jpeg && jpeg.length > 1024) return jpeg;
  } catch (err) {
    console.warn('[Camera] Resize foto gagal, memakai ukuran asli:', err.message);
  }
  return buffer;
}

/**
 * Jembatan request/response Main → Renderer, dipakai WebcamProviderService
 * untuk menyuruh renderer menghentikan MediaStream-nya.
 */
function createRendererBridge(ipcMain, getWindow) {
  const pending = new Map();
  let seq = 0;

  ipcMain.on('camera:webcam-response', (_event, payload) => {
    const entry = payload && pending.get(payload.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(payload.id);
    entry.resolve({ ok: !!payload.ok, data: payload.data, error: payload.error });
  });

  return {
    request(action, data = {}, timeoutMs = 2500) {
      const win = getWindow();
      if (!win || win.isDestroyed()) {
        return Promise.resolve({ ok: false, error: 'Jendela aplikasi tidak tersedia' });
      }
      const id = `wc-${++seq}`;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ ok: false, error: 'Renderer tidak merespon' });
        }, timeoutMs);
        pending.set(id, { resolve, timer });
        win.webContents.send('camera:webcam-request', { id, action, data });
      });
    },
  };
}

/**
 * @param {{ipcMain: Electron.IpcMain, getWindow: () => Electron.BrowserWindow|null, sessionRoot: string}} deps
 * @returns {CameraProviderManager}
 */
function registerCameraIpc({ ipcMain, getWindow, sessionRoot }) {
  const bridge = createRendererBridge(ipcMain, getWindow);

  const manager = new CameraProviderManager({
    bridge,
    sessionRoot,
    emit: (channel, payload) => {
      const win = getWindow();
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    },
  });

  ipcMain.handle('camera:healthCheck', () => manager.healthCheck());
  ipcMain.handle('camera:getStatus', () => manager.getStatus());
  ipcMain.handle('camera:startLiveView', () => manager.startLiveView());
  ipcMain.handle('camera:stopLiveView', () => manager.stopLiveView());
  ipcMain.handle('camera:capture', async () => {
    const started = Date.now();
    const res = await manager.capture();
    if (!res || !res.ok || !res.buffer) return res;

    const { buffer, ...rest } = res;
    const jpeg = toDisplayJpeg(buffer);
    console.log(
      `[Camera] Capture selesai dalam ${Date.now() - started}ms ` +
      `(${(buffer.length / 1024 / 1024).toFixed(1)} MB → ${(jpeg.length / 1024).toFixed(0)} KB)`
    );
    return { ...rest, dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}` };
  });
  ipcMain.handle('camera:getLastCaptured', () => manager.getLastCaptured());
  ipcMain.handle('camera:downloadPhoto', (_e, filename) => manager.downloadPhoto(filename));
  ipcMain.handle('camera:getProvider', () => manager.getProvider());
  ipcMain.handle('camera:setProvider', (_e, name) => manager.setProvider(name));
  ipcMain.handle('camera:setSessionActive', (_e, active) => manager.setSessionActive(active));
  ipcMain.handle('camera:getImageQuality', () => manager.getImageQuality());
  ipcMain.handle('camera:setImageQuality', (_e, value) => manager.setImageQuality(value));

  // Frame live view dikirim sebagai Buffer mentah (bukan base64) agar hemat CPU
  // dan bandwidth IPC saat polling 10–15 fps.
  ipcMain.handle('camera:getFrame', async () => {
    const res = await manager.getFrame();
    if (!res.ok || !res.buffer) return { ok: false, error: res.error, code: res.code };
    return { ok: true, mime: res.mime || 'image/jpeg', data: res.buffer };
  });

  return manager;
}

module.exports = { registerCameraIpc, createRendererBridge, defaultSessionRoot: (userDataPath) => path.join(userDataPath, 'camera-sessions') };
