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

/**
 * Ambil segmen APP1/Exif dari JPEG asli kamera.
 *
 * nativeImage.toJPEG() membuang seluruh metadata, jadi tanpa ini foto hasil
 * resize kehilangan merek/model kamera, ISO, shutter speed, lensa, dan waktu
 * pemotretan — persis yang dicari saat membuka "Details" di File Explorer.
 */
function extractExifSegment(buffer) {
  if (!buffer || buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];

    // Marker tanpa payload
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    // Mulai data gambar — EXIF pasti sudah lewat
    if (marker === 0xda) break;

    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) break;

    if (marker === 0xe1 && buffer.subarray(offset + 4, offset + 10).toString('latin1') === 'Exif\0\0') {
      return buffer.subarray(offset, offset + 2 + length);
    }
    offset += 2 + length;
  }
  return null;
}

/** Sisipkan kembali segmen Exif ke JPEG hasil re-encode. */
function insertExifSegment(jpeg, exifSegment) {
  if (!exifSegment || !jpeg || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;

  // Exif harus berada tepat setelah SOI, atau setelah APP0/JFIF bila ada.
  let insertAt = 2;
  if (jpeg.length > 4 && jpeg[2] === 0xff && jpeg[3] === 0xe0) {
    insertAt = 4 + jpeg.readUInt16BE(4);
    if (insertAt > jpeg.length) insertAt = 2;
  }

  return Buffer.concat([jpeg.subarray(0, insertAt), exifSegment, jpeg.subarray(insertAt)])
}

function toDisplayJpeg(buffer) {
  try {
    const { nativeImage } = require('electron');
    let image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) return buffer;

    const size = image.getSize();
    if (size.width <= MAX_CAPTURE_WIDTH) return buffer; // sudah kecil: pertahankan file asli apa adanya

    image = image.resize({ width: MAX_CAPTURE_WIDTH, quality: 'good' });
    const jpeg = image.toJPEG(CAPTURE_JPEG_QUALITY);
    if (!jpeg || jpeg.length <= 1024) return buffer;

    // Tempelkan kembali data kamera yang dibuang oleh toJPEG().
    return insertExifSegment(jpeg, extractExifSegment(buffer));
  } catch (err) {
    console.warn('[Camera] Resize foto gagal, memakai ukuran asli:', err.message);
  }
  return buffer;
}

/**
 * Menjaga jendela photobooth tetap di depan.
 *
 * digiCamControl adalah aplikasi desktop biasa: `CMD=LiveViewWnd_Show` membuka
 * jendela Live View miliknya dan `CMD=Capture` memunculkan jendela preview foto.
 * Keduanya muncul di atas aplikasi photobooth yang berjalan fullscreen.
 *
 * Windows membatasi SetForegroundWindow, jadi `focus()` saja tidak cukup
 * andal — yang benar-benar menjamin urutan tumpukan adalah setAlwaysOnTop,
 * dipasang selama sesi kamera berlangsung lalu dilepas setelahnya.
 */
function createWindowGuard(getWindow) {
  let timers = [];
  let pinned = false;

  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };

  const bringToFront = () => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    try {
      if (win.isMinimized()) win.restore();
      win.moveTop();
      win.focus();
    } catch (err) {
      console.warn('[Camera] Gagal mengangkat jendela aplikasi:', err.message);
    }
  };

  return {
    /** Dipanggil setelah perintah digiCamControl yang memunculkan jendela. */
    reclaim() {
      clearTimers();
      bringToFront();
      // Jendela digiCamControl kadang baru muncul beberapa ratus milidetik
      // setelah perintahnya dijawab, jadi rebut posisi depan beberapa kali.
      [150, 450, 1000].forEach((ms) => timers.push(setTimeout(bringToFront, ms)));
    },

    /** Kunci di atas selama sesi kamera; dilepas saat sesi selesai. */
    setPinned(value) {
      const win = getWindow();
      pinned = !!value;
      if (!win || win.isDestroyed()) return;
      try {
        win.setAlwaysOnTop(pinned, 'screen-saver');
      } catch (err) {
        console.warn('[Camera] Gagal mengunci jendela di depan:', err.message);
      }
      if (pinned) bringToFront();
      else clearTimers();
    },

    isPinned: () => pinned,
    dispose: clearTimers,
  };
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
  const windowGuard = createWindowGuard(getWindow);

  const manager = new CameraProviderManager({
    bridge,
    sessionRoot,
    windowGuard,
    emit: (channel, payload) => {
      const win = getWindow();
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    },
  });

  ipcMain.handle('camera:healthCheck', () => manager.healthCheck());
  ipcMain.handle('camera:getStatus', () => manager.getStatus());
  ipcMain.handle('camera:startLiveView', () => manager.startLiveView());
  ipcMain.handle('camera:stopLiveView', () => manager.stopLiveView());
  function packPhoto(res, started, label) {
    if (!res || !res.ok || !res.buffer) return res;
    const { buffer, ...rest } = res;
    const jpeg = toDisplayJpeg(buffer);
    console.log(
      `[Camera] ${label} selesai dalam ${Date.now() - started}ms ` +
      `(${(buffer.length / 1024 / 1024).toFixed(1)} MB → ${(jpeg.length / 1024).toFixed(0)} KB` +
      `${jpeg === buffer ? ', file asli' : ', EXIF dipertahankan'})`
    );
    return { ...rest, dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}` };
  }

  ipcMain.handle('camera:capture', async () => {
    const started = Date.now();
    return packPhoto(await manager.capture(), started, 'Capture');
  });

  // Alur terpisah: shutter jatuh tepat di akhir countdown, pengambilan file
  // berjalan setelahnya tanpa menggeser momen foto.
  ipcMain.handle('camera:armCapture', () => manager.armCapture());

  ipcMain.handle('camera:fireShutter', async () => {
    const started = Date.now();
    const res = await manager.fireShutter();
    console.log(`[Camera] Shutter ${res?.ok ? 'jatuh' : 'GAGAL'} dalam ${Date.now() - started}ms (${res?.command || '-'})`);
    return res;
  });

  ipcMain.handle('camera:collectPhoto', async () => {
    const started = Date.now();
    return packPhoto(await manager.collectPhoto(), started, 'Ambil file');
  });

  ipcMain.handle('camera:getShutterCommand', () => manager.getShutterCommand());
  // Dialog pilih folder — jauh lebih ramah daripada mengetik path manual,
  // apalagi di layar sentuh photobooth.
  ipcMain.handle('camera:browseFolder', async (_e, current) => {
    const { dialog } = require('electron');
    const win = getWindow();
    const opts = {
      title: 'Pilih folder simpan EOS Utility',
      properties: ['openDirectory'],
      defaultPath: current || undefined,
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || !res.filePaths?.length) return { ok: false, canceled: true };
    return { ok: true, path: res.filePaths[0] };
  });

  ipcMain.handle('camera:getPreviewSource', () => manager.getPreviewSource());
  ipcMain.handle('camera:setPreviewSource', (_e, v) => manager.setPreviewSource(v));
  ipcMain.handle('camera:getEosUtilityFolder', () => manager.getEosUtilityFolder());
  ipcMain.handle('camera:setEosUtilityFolder', (_e, v) => manager.setEosUtilityFolder(v));
  ipcMain.handle('camera:getEosUtilityShutter', () => manager.getEosUtilityShutter());
  ipcMain.handle('camera:setEosUtilityShutter', (_e, v) => manager.setEosUtilityShutter(v));
  ipcMain.handle('camera:setShutterCommand', (_e, value) => manager.setShutterCommand(value));
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
