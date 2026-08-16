/**
 * CameraProviderManager
 * ---------------------
 * Satu-satunya titik yang dipanggil IPC handler. Handler tidak perlu tahu
 * provider mana yang sedang aktif.
 *
 * Tanggung jawab:
 *  - baca provider aktif dari config (.env mutable)
 *  - instantiate provider yang sesuai
 *  - tangani perpindahan provider: stop yang lama → init yang baru →
 *    health check → rollback bila gagal
 *  - tolak perpindahan saat sesi photobooth sedang berjalan
 */
const fs = require('fs');
const path = require('path');

const { WebcamProviderService } = require('./WebcamProviderService');
const { DigiCamControlService } = require('./DigiCamControlService');
const config = require('./cameraConfig');

class CameraProviderManager {
  /**
   * @param {{bridge?: object, sessionRoot: string, emit?: (channel: string, payload: any) => void}} options
   */
  constructor(options = {}) {
    this.bridge = options.bridge || null;
    this.sessionRoot = options.sessionRoot;
    this.emit = options.emit || (() => {});

    /** @type {import('./ICameraProvider').ICameraProvider|null} */
    this.provider = null;
    this.activeName = config.DEFAULT_PROVIDER;
    this.sessionActive = false;
    this.currentSessionDir = null;
    this.switching = false;
  }

  _create(name) {
    if (name === 'digicamcontrol') {
      return new DigiCamControlService({
        baseUrl: config.readDigiCamUrl(),
        sessionDir: this.currentSessionDir || this.sessionRoot,
        imageQuality: config.readDigiCamQuality(),
        shutterCommand: config.readDigiCamShutter(),
      });
    }
    return new WebcamProviderService({ bridge: this.bridge });
  }

  /** Dipanggil sekali saat app siap. Tidak pernah melempar. */
  async init() {
    const stored = config.readProvider();
    this.activeName = stored;
    this.provider = this._create(stored);

    const health = await this.safeHealthCheck();
    if (!health.connected && stored !== config.DEFAULT_PROVIDER) {
      console.warn(`[Camera] Provider "${stored}" gagal health check saat startup: ${health.error}`);
      await this._disposeCurrent();
      this.activeName = config.DEFAULT_PROVIDER;
      this.provider = this._create(config.DEFAULT_PROVIDER);
      const fallbackHealth = await this.safeHealthCheck();
      this._broadcast({
        ...fallbackHealth,
        provider: this.activeName,
        error: `Provider "${stored}" tidak tersedia saat startup (${health.error}). Sementara memakai Webcam Utility.`,
        fallback: true,
      });
      return;
    }

    console.log(`[Camera] Provider aktif: ${this.activeName} (connected=${health.connected})`);
  }

  async _disposeCurrent() {
    if (!this.provider) return;
    try {
      await this.provider.stopLiveView();
    } catch (err) {
      console.warn('[Camera] stopLiveView saat dispose gagal:', err.message);
    }
    try {
      await this.provider.dispose();
    } catch (err) {
      console.warn('[Camera] dispose provider gagal:', err.message);
    }
    this.provider = null;
  }

  _broadcast(payload) {
    this.emit('camera:providerChanged', {
      provider: this.activeName,
      connected: false,
      ...payload,
    });
  }

  getProvider() {
    return this.activeName;
  }

  /**
   * Ganti provider aktif.
   * @param {'webcam'|'digicamcontrol'} name
   */
  async setProvider(name) {
    if (!config.isValidProvider(name)) {
      return { ok: false, code: 'INVALID_PROVIDER', error: `Provider tidak dikenal: ${name}` };
    }

    if (this.sessionActive) {
      return {
        ok: false,
        code: 'SESSION_ACTIVE',
        provider: this.activeName,
        error: 'Selesaikan atau batalkan sesi saat ini sebelum mengganti sumber kamera',
      };
    }

    if (this.switching) {
      return { ok: false, code: 'SWITCH_IN_PROGRESS', provider: this.activeName, error: 'Perpindahan provider sedang berjalan' };
    }

    if (name === this.activeName) {
      const health = await this.safeHealthCheck();
      return { ok: true, provider: this.activeName, unchanged: true, ...health };
    }

    this.switching = true;
    const previousName = this.activeName;

    try {
      // 1. Hentikan provider lama dengan bersih (live view, polling, koneksi HTTP pending / MediaStream).
      await this._disposeCurrent();

      // 2. Inisialisasi provider baru.
      this.activeName = name;
      this.provider = this._create(name);

      // 3. Health check provider baru.
      const health = await this.safeHealthCheck();

      if (!health.connected) {
        // 4. Rollback — jangan pernah tinggalkan aplikasi tanpa kamera aktif.
        await this._disposeCurrent();
        this.activeName = previousName;
        this.provider = this._create(previousName);
        const rolledBack = await this.safeHealthCheck();

        const payload = {
          ok: false,
          code: 'HEALTHCHECK_FAILED',
          provider: previousName,
          connected: rolledBack.connected,
          rolledBackTo: previousName,
          error: health.error || 'Provider baru tidak dapat dihubungi',
        };
        this._broadcast(payload);
        return payload;
      }

      config.writeProvider(name);

      const payload = { ok: true, provider: name, connected: true, ...health };
      this._broadcast(payload);
      return payload;
    } catch (err) {
      // Kegagalan tak terduga: kembalikan ke provider sebelumnya.
      await this._disposeCurrent();
      this.activeName = previousName;
      this.provider = this._create(previousName);
      const rolledBack = await this.safeHealthCheck();
      const payload = {
        ok: false,
        code: 'SWITCH_ERROR',
        provider: previousName,
        connected: rolledBack.connected,
        rolledBackTo: previousName,
        error: err.message,
      };
      this._broadcast(payload);
      return payload;
    } finally {
      this.switching = false;
    }
  }

  async safeHealthCheck() {
    if (!this.provider) {
      return { connected: false, provider: this.activeName, error: 'Provider belum diinisialisasi' };
    }
    try {
      return await this.provider.healthCheck();
    } catch (err) {
      return { connected: false, provider: this.activeName, error: err.message };
    }
  }

  async healthCheck() {
    return this.safeHealthCheck();
  }

  async getStatus() {
    if (!this.provider) {
      return { connected: false, provider: this.activeName, error: 'Provider belum diinisialisasi' };
    }
    try {
      const status = await this.provider.getStatus();
      return { ...status, provider: this.activeName, sessionActive: this.sessionActive };
    } catch (err) {
      return { connected: false, provider: this.activeName, error: err.message };
    }
  }

  /**
   * Tandai sesi photobooth sedang berjalan. Selama true, setProvider ditolak.
   * Untuk digiCamControl, folder sesi di-set eksplisit ke folder photobooth.
   */
  async setSessionActive(active) {
    this.sessionActive = !!active;

    if (!this.sessionActive) {
      this.currentSessionDir = null;
      return { ok: true, sessionActive: false };
    }

    if (this.activeName !== 'digicamcontrol' || !this.provider) {
      return { ok: true, sessionActive: true };
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(this.sessionRoot, stamp);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      return { ok: true, sessionActive: true, warning: `Gagal membuat folder sesi: ${err.message}` };
    }

    this.currentSessionDir = dir;
    const res = await this.provider.setSessionFolder(dir);
    return { ok: true, sessionActive: true, sessionDir: dir, folderSet: res.ok, warning: res.error };
  }

  async startLiveView() {
    if (!this.provider) return { ok: false, error: 'Provider belum diinisialisasi' };
    try {
      return await this.provider.startLiveView();
    } catch (err) {
      return { ok: false, provider: this.activeName, error: err.message };
    }
  }

  async stopLiveView() {
    if (!this.provider) return { ok: true };
    try {
      return await this.provider.stopLiveView();
    } catch (err) {
      return { ok: false, provider: this.activeName, error: err.message };
    }
  }

  async getFrame() {
    if (!this.provider) return { ok: false, error: 'Provider belum diinisialisasi' };
    try {
      return await this.provider.getFrame();
    } catch (err) {
      return { ok: false, provider: this.activeName, error: err.message };
    }
  }

  async capture() {
    if (!this.provider) return { ok: false, error: 'Provider belum diinisialisasi' };
    try {
      return await this.provider.capture({ sessionDir: this.currentSessionDir || this.sessionRoot });
    } catch (err) {
      return { ok: false, provider: this.activeName, error: err.message };
    }
  }

  /** Persiapan sebelum momen jepret (dipanggil saat countdown mulai). */
  async armCapture() {
    if (!this.provider) return { ok: false, error: 'Provider belum diinisialisasi' };
    if (typeof this.provider.armCapture !== 'function') return { ok: true, skipped: true };
    try {
      return await this.provider.armCapture();
    } catch (err) {
      return { ok: false, provider: this.activeName, error: err.message };
    }
  }

  /** Momen jepret — harus secepat mungkin. */
  async fireShutter() {
    if (!this.provider) return { ok: false, error: 'Provider belum diinisialisasi' };
    if (typeof this.provider.fireShutter !== 'function') {
      return { ok: false, code: 'RENDERER_OWNED', provider: this.activeName };
    }
    try {
      return await this.provider.fireShutter();
    } catch (err) {
      return { ok: false, provider: this.activeName, error: err.message };
    }
  }

  /** Ambil file hasil jepretan setelah shutter jatuh. */
  async collectPhoto() {
    if (!this.provider) return { ok: false, error: 'Provider belum diinisialisasi' };
    if (typeof this.provider.collectPhoto !== 'function') {
      return { ok: false, code: 'RENDERER_OWNED', provider: this.activeName };
    }
    try {
      return await this.provider.collectPhoto({ sessionDir: this.currentSessionDir || this.sessionRoot });
    } catch (err) {
      return { ok: false, provider: this.activeName, error: err.message };
    }
  }

  getShutterCommand() {
    return config.readDigiCamShutter();
  }

  setShutterCommand(value) {
    const stored = config.writeDigiCamShutter(value);
    if (this.provider) this.provider.shutterCommand = stored;
    return { ok: true, value: stored };
  }

  async getLastCaptured() {
    if (!this.provider) return { ok: false, filename: null, error: 'Provider belum diinisialisasi' };
    try {
      return await this.provider.getLastCaptured();
    } catch (err) {
      return { ok: false, filename: null, error: err.message };
    }
  }

  async downloadPhoto(filename) {
    if (!this.provider) return { ok: false, error: 'Provider belum diinisialisasi' };
    try {
      const res = await this.provider.downloadPhoto(filename);
      if (res.ok && res.buffer) {
        return {
          ok: true,
          filename: res.filename,
          dataUrl: `data:image/jpeg;base64,${res.buffer.toString('base64')}`,
        };
      }
      return res;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  getImageQuality() {
    return config.readDigiCamQuality();
  }

  /**
   * Simpan dan terapkan kualitas JPEG kamera. Hanya berpengaruh pada
   * digiCamControl; provider webcam mengabaikannya.
   */
  async setImageQuality(value) {
    const stored = config.writeDigiCamQuality(value);
    if (this.provider && typeof this.provider.setImageQuality === 'function') {
      this.provider.imageQuality = stored;
      const res = await this.provider.setImageQuality(stored);
      return { ok: true, value: stored, appliedNow: res.ok, response: res.response };
    }
    return { ok: true, value: stored, appliedNow: false };
  }

  async shutdown() {
    await this._disposeCurrent();
  }
}

module.exports = { CameraProviderManager };
