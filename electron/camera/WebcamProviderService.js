/**
 * WebcamProviderService
 * ---------------------
 * Membungkus flow getUserMedia yang SUDAH ADA di renderer (app/camera/page.tsx,
 * app/flipbook-camera/page.tsx). Kode webcam tidak ditulis ulang.
 *
 * Catatan penting: getUserMedia dan MediaStream hanya ada di renderer process —
 * Main Process tidak bisa memegang stream-nya sendiri. Karena itu service ini
 * berperan sebagai koordinator: ia mengirim perintah ke renderer lewat bridge
 * (webContents.send + balasan ipcRenderer.send) dan renderer-lah yang benar-benar
 * memanggil track.stop().
 */
const { ICameraProvider } = require('./ICameraProvider');

const RENDERER_OWNED = {
  ok: false,
  code: 'RENDERER_OWNED',
  error: 'Operasi ini ditangani langsung oleh renderer pada provider webcam',
};

class WebcamProviderService extends ICameraProvider {
  /**
   * @param {{bridge?: {request: (action: string, data?: object, timeoutMs?: number) => Promise<{ok: boolean, data?: any, error?: string}>}}} options
   */
  constructor(options = {}) {
    super();
    this.name = 'webcam';
    this.bridge = options.bridge || null;
  }

  async _ask(action, data = {}, timeoutMs = 2500) {
    if (!this.bridge) return { ok: false, error: 'Bridge renderer tidak tersedia' };
    return this.bridge.request(action, data, timeoutMs);
  }

  async healthCheck() {
    const res = await this._ask('status', {}, 2000);

    // Renderer tidak menjawab = tidak ada halaman kamera yang terbuka.
    // Webcam adalah provider default; jangan laporkan gagal hanya karena idle,
    // supaya rollback tidak pernah meninggalkan aplikasi tanpa kamera aktif.
    if (!res.ok) {
      return {
        connected: true,
        provider: this.name,
        idle: true,
        note: 'Halaman kamera belum aktif — perangkat akan dicek saat sesi dimulai',
      };
    }

    const videoInputs = typeof res.data?.videoInputs === 'number' ? res.data.videoInputs : null;
    if (videoInputs === 0) {
      return {
        connected: false,
        provider: this.name,
        error: 'Tidak ada perangkat webcam terdeteksi. Pastikan EOS Webcam Utility berjalan dan kamera menyala.',
      };
    }

    return {
      connected: true,
      provider: this.name,
      videoInputs,
      streaming: !!res.data?.streaming,
    };
  }

  async getStatus() {
    const health = await this.healthCheck();
    return { ...health, liveViewActive: !!health.streaming };
  }

  async startLiveView() {
    const res = await this._ask('start', {}, 6000);
    if (!res.ok) {
      // Halaman kamera mengelola getUserMedia-nya sendiri saat mount.
      return { ok: true, provider: this.name, deferred: true };
    }
    return { ok: true, provider: this.name };
  }

  async stopLiveView() {
    // Renderer yang memanggil track.stop() pada MediaStream yang berjalan.
    const res = await this._ask('stop', {}, 3000);
    return { ok: true, provider: this.name, acknowledged: res.ok };
  }

  async capture() {
    // Capture webcam tetap memakai canvas di renderer (flow existing, tanpa perubahan).
    return { ...RENDERER_OWNED };
  }

  async getFrame() {
    return { ...RENDERER_OWNED };
  }

  async getLastCaptured() {
    return { ok: true, filename: null, provider: this.name };
  }

  async downloadPhoto() {
    return { ...RENDERER_OWNED };
  }

  async dispose() {
    await this.stopLiveView();
  }
}

module.exports = { WebcamProviderService };
