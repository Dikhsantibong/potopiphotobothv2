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
const { EosUtilityService } = require('./EosUtilityService');
const config = require('./cameraConfig');

class CameraProviderManager {
  /**
   * @param {{bridge?: object, sessionRoot: string, emit?: (channel: string, payload: any) => void}} options
   */
  constructor(options = {}) {
    this.bridge = options.bridge || null;
    this.sessionRoot = options.sessionRoot;
    this.emit = options.emit || (() => {});
    // Menjaga jendela photobooth tetap di atas jendela digiCamControl.
    this.windowGuard = options.windowGuard || null;

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
        // Saat preview datang dari webcam (Hybrid DSLR Mode), live view
        // digiCamControl tidak perlu dinyalakan — jendelanya pun tidak muncul.
        liveViewForCapture: config.readPreviewSource() !== 'webcam',
        // Dipanggil tepat setelah perintah yang memunculkan jendela digiCamControl.
        onWindowRaised: () => this.windowGuard?.reclaim(),
      });
    }
    if (name === 'eosutility') {
      return new EosUtilityService({
        watchFolder: config.readEosUtilityFolder(),
        shutterMode: config.readEosUtilityShutter(),
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
      // Lepas kunci supaya di luar sesi (Settings, dialog sistem) aplikasi
      // berperilaku normal.
      this.windowGuard?.setPinned(false);
      return { ok: true, sessionActive: false };
    }

    if (this.activeName === 'eosutility' && this.provider) {
      // EOS Utility memakai folder simpannya sendiri; aplikasi hanya memantau.
      // Jendela tidak dikunci karena mode keystroke justru perlu mengaktifkan
      // jendela EOS Utility.
      this.windowGuard?.setPinned(false);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const dir = path.join(this.sessionRoot, stamp);
      try {
        fs.mkdirSync(dir, { recursive: true });
        this.currentSessionDir = dir;
      } catch (err) {
        return { ok: true, sessionActive: true, warning: `Gagal membuat folder sesi: ${err.message}` };
      }
      this.pruneOldSessions();
      return { ok: true, sessionActive: true, sessionDir: dir };
    }

    if (this.activeName !== 'digicamcontrol' || !this.provider) {
      // Provider webcam tidak memunculkan jendela pihak ketiga.
      this.windowGuard?.setPinned(false);
      return { ok: true, sessionActive: true };
    }

    // Selama sesi digiCamControl, jendela photobooth dikunci di atas jendela
    // Live View dan preview foto milik digiCamControl.
    this.windowGuard?.setPinned(true);

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(this.sessionRoot, stamp);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      return { ok: true, sessionActive: true, warning: `Gagal membuat folder sesi: ${err.message}` };
    }

    this.currentSessionDir = dir;
    const res = await this.provider.setSessionFolder(dir);

    // Jangan sampai disk penuh diam-diam (lihat pruneOldSessions).
    this.pruneOldSessions();

    return { ok: true, sessionActive: true, sessionDir: dir, folderSet: res.ok, warning: res.error };
  }

  /**
   * Buang folder sesi lama.
   *
   * Setiap sesi menyimpan JPEG resolusi penuh dari kamera (Large ~7 MB,
   * Medium ~3 MB) dikali jumlah frame. Pada mesin photobooth yang ramai itu
   * bisa berarti beberapa GB per hari, dan tidak ada apa pun yang membersihkan
   * folder-folder itu — disk akan penuh dalam hitungan minggu, lalu capture
   * mulai gagal karena digiCamControl tidak bisa menulis file.
   *
   * Foto yang sudah jadi tetap aman: hasil akhirnya sudah diunggah ke server
   * dan disalin lewat backup lokal. Folder ini hanya arsip mentah sementara.
   */
  pruneOldSessions({ keepDays = 7, keepMax = 200 } = {}) {
    let entries;
    try {
      entries = fs.readdirSync(this.sessionRoot, { withFileTypes: true });
    } catch {
      return { removed: 0 }; // folder belum ada
    }

    const folders = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(this.sessionRoot, entry.name);
      try {
        folders.push({ full, mtimeMs: fs.statSync(full).mtimeMs });
      } catch {
        /* lewati yang tidak terbaca */
      }
    }

    folders.sort((a, b) => b.mtimeMs - a.mtimeMs); // terbaru dulu

    const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
    let removed = 0;

    folders.forEach((folder, index) => {
      // Sesi yang sedang berjalan tidak pernah disentuh.
      if (folder.full === this.currentSessionDir) return;
      const tooOld = folder.mtimeMs < cutoff;
      const tooMany = index >= keepMax;
      if (!tooOld && !tooMany) return;
      try {
        fs.rmSync(folder.full, { recursive: true, force: true });
        removed++;
      } catch (err) {
        console.warn('[Camera] Gagal menghapus folder sesi lama:', err.message);
      }
    });

    if (removed > 0) {
      console.log(`[Camera] ${removed} folder sesi lama dibersihkan (simpan ${keepDays} hari / ${keepMax} sesi terakhir)`);
    }
    return { removed, total: folders.length };
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

  getPreviewSource() {
    return config.readPreviewSource();
  }

  setPreviewSource(value) {
    const stored = config.writePreviewSource(value);
    // Provider DSLR perlu tahu: saat preview dari webcam, live view kamera
    // tidak perlu dinyalakan sama sekali.
    if (this.provider) this.provider.liveViewForCapture = stored !== 'webcam';
    return { ok: true, value: stored };
  }

  getEosUtilityFolder() {
    return config.readEosUtilityFolder();
  }

  setEosUtilityFolder(value) {
    const stored = config.writeEosUtilityFolder(value);
    if (this.provider && this.activeName === 'eosutility') {
      this.provider.watchFolder = stored;
    }
    return { ok: true, value: stored };
  }

  getEosUtilityShutter() {
    return config.readEosUtilityShutter();
  }

  setEosUtilityShutter(value) {
    const stored = config.writeEosUtilityShutter(value);
    if (this.provider && this.activeName === 'eosutility') {
      this.provider.shutterMode = stored;
    }
    return { ok: true, value: stored };
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
    this.windowGuard?.setPinned(false);
    this.windowGuard?.dispose?.();
    await this._disposeCurrent();
  }
}

module.exports = { CameraProviderManager };
