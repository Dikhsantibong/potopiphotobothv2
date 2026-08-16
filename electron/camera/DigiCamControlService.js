/**
 * DigiCamControlService
 * ---------------------
 * Bicara ke digiCamControl Web Server lewat HTTP (default http://127.0.0.1:5513).
 *
 * Endpoint yang dipakai (semua di port 5513):
 *   GET /                                                 → health check
 *   GET /?CMD=LiveViewWnd_Show                            → mulai live view
 *   GET /?CMD=LiveViewWnd_Hide                            → hentikan live view
 *   GET /liveview.jpg?t=<ts>                              → frame live view (cache-busted)
 *   GET /?CMD=Capture                                     → trigger shutter
 *   GET /?slc=get&param1=lastcaptured&param2=             → nama file terakhir
 *   GET /image/<filename>                                 → unduh file hasil capture
 *   GET /preview.jpg                                      → fallback foto terakhir
 *   GET /session.json                                     → data sesi
 *   GET /?slc=set&param1=session.folder&param2=<path>     → set folder penyimpanan
 *
 * Tidak ada asumsi endpoint MJPEG di port lain.
 */
const fs = require('fs');
const path = require('path');
const { ICameraProvider } = require('./ICameraProvider');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** JPEG utuh diawali FFD8 dan diakhiri FFD9. Dipakai untuk menolak file yang masih ditulis. */
function isCompleteJpeg(buffer) {
  if (!buffer || buffer.length < 1024) return false;
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return false;
  return buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
}

class DigiCamControlService extends ICameraProvider {
  constructor(options = {}) {
    super();
    this.name = 'digicamcontrol';
    this.baseUrl = (options.baseUrl || 'http://127.0.0.1:5513').replace(/\/+$/, '');
    this.sessionDir = options.sessionDir || null;
    this.liveViewActive = false;
    this.disposed = false;
    /** @type {Set<AbortController>} semua request HTTP yang masih menggantung */
    this.pending = new Set();
    /** Sidik jari foto terakhir, dipakai fallback agar tidak mengambil foto duplikat. */
    this.lastCaptureSignature = null;
  }

  static signature(buffer) {
    return `${buffer.length}:${buffer.subarray(0, 64).toString('hex')}`;
  }

  // ── HTTP helpers ────────────────────────────────────────────
  async _fetch(suffix, { timeout = 4000, raw = false } = {}) {
    if (this.disposed) throw new Error('Provider digiCamControl sudah dihentikan');
    const controller = new AbortController();
    this.pending.add(controller);
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(this.baseUrl + suffix, { signal: controller.signal });
      if (raw) {
        const buffer = Buffer.from(await res.arrayBuffer());
        return { status: res.status, ok: res.ok, buffer };
      }
      return { status: res.status, ok: res.ok, text: await res.text() };
    } finally {
      clearTimeout(timer);
      this.pending.delete(controller);
    }
  }

  _cmd(cmd, opts) {
    return this._fetch(`/?CMD=${encodeURIComponent(cmd)}`, opts);
  }

  _abortPending() {
    for (const controller of this.pending) {
      try {
        controller.abort();
      } catch {
        /* sudah selesai */
      }
    }
    this.pending.clear();
  }

  _describeError(err) {
    if (err && err.name === 'AbortError') return 'timeout';
    return (err && err.message) || String(err);
  }

  // ── ICameraProvider ─────────────────────────────────────────
  async healthCheck() {
    try {
      const res = await this._fetch('/', { timeout: 2500 });
      if (res.status >= 500) {
        return {
          connected: false,
          provider: this.name,
          error: `DigiCamControl Web Server merespon error (HTTP ${res.status})`,
        };
      }
      return { connected: true, provider: this.name, baseUrl: this.baseUrl };
    } catch (err) {
      return {
        connected: false,
        provider: this.name,
        error: `DigiCamControl Web Server tidak tersedia (${this._describeError(err)}). ` +
          `Jalankan digiCamControl lalu aktifkan Settings → Webserver → Use web server.`,
      };
    }
  }

  async getStatus() {
    const health = await this.healthCheck();
    if (!health.connected) return { ...health, liveViewActive: false };

    const status = {
      ...health,
      liveViewActive: this.liveViewActive,
      sessionDir: this.sessionDir,
    };

    // Daftar kamera — bila endpoint tidak tersedia, jangan anggap error fatal.
    try {
      const res = await this._fetch('/?slc=list&param1=cameras&param2=', { timeout: 2500 });
      if (res.ok) {
        const cameras = (res.text || '')
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        status.cameras = cameras;
        status.cameraDetected = cameras.length > 0;
      }
    } catch {
      /* endpoint list tidak wajib */
    }

    try {
      const res = await this._fetch('/session.json', { timeout: 2500 });
      if (res.ok && res.text) status.session = JSON.parse(res.text);
    } catch {
      /* session.json tidak wajib */
    }

    return status;
  }

  /** Set folder penyimpanan di sisi digiCamControl secara eksplisit. */
  async setSessionFolder(dir) {
    if (!dir) return { ok: false, error: 'Folder sesi kosong' };
    try {
      fs.mkdirSync(dir, { recursive: true });
      const res = await this._fetch(
        `/?slc=set&param1=session.folder&param2=${encodeURIComponent(dir)}`,
        { timeout: 4000 }
      );
      this.sessionDir = dir;
      return { ok: res.ok, dir, response: (res.text || '').trim() };
    } catch (err) {
      return { ok: false, error: `Gagal set folder sesi: ${this._describeError(err)}` };
    }
  }

  async startLiveView() {
    const health = await this.healthCheck();
    if (!health.connected) return { ok: false, ...health };

    try {
      await this._cmd('LiveViewWnd_Show', { timeout: 5000 });
    } catch (err) {
      return {
        ok: false,
        connected: false,
        provider: this.name,
        error: `Gagal memulai live view: ${this._describeError(err)}`,
      };
    }

    // Live view butuh waktu untuk menghasilkan frame pertama.
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline && !this.disposed) {
      try {
        const frame = await this._fetch(`/liveview.jpg?t=${Date.now()}`, { timeout: 2500, raw: true });
        if (frame.ok && frame.buffer.length > 1024) {
          this.liveViewActive = true;
          return { ok: true, connected: true, provider: this.name };
        }
      } catch {
        /* coba lagi sampai deadline */
      }
      await delay(250);
    }

    return {
      ok: false,
      connected: false,
      provider: this.name,
      error: 'Live view tidak menghasilkan frame. Pastikan kamera menyala dan tidak sedang dipakai EOS Webcam Utility.',
    };
  }

  async stopLiveView() {
    this.liveViewActive = false;
    this._abortPending();
    try {
      await this._cmd('LiveViewWnd_Hide', { timeout: 3000 });
    } catch {
      /* server mungkin sudah mati — tetap dianggap berhenti */
    }
    return { ok: true, provider: this.name };
  }

  async getFrame() {
    if (!this.liveViewActive) {
      return { ok: false, code: 'LIVEVIEW_INACTIVE', error: 'Live view belum aktif' };
    }
    try {
      const frame = await this._fetch(`/liveview.jpg?t=${Date.now()}`, { timeout: 2500, raw: true });
      if (!frame.ok || frame.buffer.length < 512) {
        return { ok: false, error: `Frame tidak tersedia (HTTP ${frame.status})` };
      }
      return { ok: true, buffer: frame.buffer, mime: 'image/jpeg' };
    } catch (err) {
      return { ok: false, error: `Frame gagal diambil (${this._describeError(err)})` };
    }
  }

  async getLastCaptured() {
    try {
      const res = await this._fetch('/?slc=get&param1=lastcaptured&param2=', { timeout: 3000 });
      const raw = (res.text || '').trim();
      const filename = raw && raw !== '-' ? raw : null;
      return { ok: res.ok, filename, raw };
    } catch (err) {
      return { ok: false, filename: null, error: this._describeError(err) };
    }
  }

  /**
   * Unduh satu file hasil capture. Mencoba /image/<filename> lalu jatuh ke
   * /preview.jpg, dan menolak JPEG yang belum selesai ditulis.
   */
  async downloadPhoto(filename, { deadline = Date.now() + 8000 } = {}) {
    const basename = filename ? path.basename(filename) : null;
    let lastError = 'Tidak ada respons';
    let imageAttempts = 0;

    while (Date.now() < deadline && !this.disposed) {
      if (basename) {
        try {
          const res = await this._fetch(`/image/${encodeURIComponent(basename)}`, { timeout: 8000, raw: true });
          imageAttempts++;
          if (res.ok && isCompleteJpeg(res.buffer)) {
            return { ok: true, buffer: res.buffer, filename: basename, source: 'image' };
          }
          lastError = res.ok
            ? 'File JPG belum selesai ditulis'
            : `HTTP ${res.status} saat mengunduh ${basename}`;
        } catch (err) {
          imageAttempts++;
          lastError = this._describeError(err);
        }
      }

      // /preview.jpg hanya dipakai bila /image/<nama> memang tidak tersedia.
      // Dipakai terlalu dini, preview bisa mengembalikan foto SEBELUMNYA dan
      // menghasilkan frame duplikat di template.
      if (!basename || imageAttempts >= 3) {
        try {
          const res = await this._fetch(`/preview.jpg?t=${Date.now()}`, { timeout: 8000, raw: true });
          if (res.ok && isCompleteJpeg(res.buffer)) {
            return { ok: true, buffer: res.buffer, filename: basename, source: 'preview' };
          }
        } catch (err) {
          lastError = this._describeError(err);
        }
      }

      await delay(200);
    }

    return { ok: false, error: `Gagal mengunduh foto: ${lastError}` };
  }

  /**
   * Trigger shutter → tunggu lastcaptured berubah → unduh → simpan ke folder sesi.
   * @returns {Promise<{ok:boolean, filePath?:string, dataUrl?:string, filename?:string, error?:string}>}
   */
  async capture({ sessionDir, timeoutMs = 12000, pollIntervalMs = 250 } = {}) {
    const targetDir = sessionDir || this.sessionDir;

    // Tidak ada health check terpisah di sini: live view yang aktif sudah
    // membuktikan web server hidup, dan satu round trip ekstra ke web server
    // yang melayani request secara berurutan langsung terasa di UI.
    if (!this.liveViewActive) {
      const lv = await this.startLiveView();
      if (!lv.ok) return { ok: false, code: 'LIVEVIEW_FAILED', error: lv.error };
    }

    // Kosongkan antrean /liveview.jpg supaya web server fokus melayani
    // Capture dan transfer file.
    this._abortPending();

    const before = (await this.getLastCaptured()).filename;

    try {
      await this._cmd('Capture', { timeout: 8000 });
    } catch (err) {
      return { ok: false, code: 'CAPTURE_FAILED', error: `Shutter gagal dipicu (${this._describeError(err)})` };
    }

    // Respons HTTP dari Capture TIDAK berarti JPG sudah jadi — harus di-poll.
    const deadline = Date.now() + timeoutMs;
    let filename = null;
    let wait = 150; // cek pertama lebih cepat; sisanya pakai interval normal
    while (Date.now() < deadline && !this.disposed) {
      await delay(wait);
      wait = pollIntervalMs;
      const current = await this.getLastCaptured();
      if (current.filename && current.filename !== before) {
        filename = current.filename;
        break;
      }
    }

    let downloaded;

    if (filename) {
      downloaded = await this.downloadPhoto(filename, { deadline: Date.now() + 8000 });
    } else {
      // Sebagian konfigurasi kamera (mis. menyimpan hanya ke SD card) tidak
      // pernah memperbarui lastcaptured. Coba /preview.jpg sekali, dan terima
      // hanya bila isinya berbeda dari foto terakhir — supaya tidak duplikat.
      downloaded = { ok: false };
      try {
        const preview = await this._fetch(`/preview.jpg?t=${Date.now()}`, { timeout: 6000, raw: true });
        if (preview.ok && isCompleteJpeg(preview.buffer)) {
          const sig = DigiCamControlService.signature(preview.buffer);
          if (sig !== this.lastCaptureSignature) {
            downloaded = { ok: true, buffer: preview.buffer, filename: null, source: 'preview' };
          }
        }
      } catch {
        /* fallback gagal — laporkan timeout di bawah */
      }

      if (!downloaded.ok) {
        return {
          ok: false,
          code: 'CAPTURE_TIMEOUT',
          error: 'Kamera tidak merespon, coba lagi. Pastikan kamera berhasil fokus dan digiCamControl menyimpan foto ke PC (bukan hanya ke SD card).',
        };
      }
    }

    if (!downloaded.ok) {
      return { ok: false, code: 'DOWNLOAD_FAILED', error: downloaded.error };
    }

    this.lastCaptureSignature = DigiCamControlService.signature(downloaded.buffer);

    // Kamera menutup live view saat shutter jalan. Nyalakan lagi tanpa menunggu
    // supaya frame berikutnya sudah siap begitu user menekan ULANGI/LANJUT.
    this._cmd('LiveViewWnd_Show', { timeout: 4000 }).catch(() => { });

    // Buffer dikembalikan mentah; lapisan IPC yang mengecilkannya sebelum
    // dikirim ke renderer. File di folder sesi tetap resolusi penuh.
    const result = {
      ok: true,
      provider: this.name,
      // Jalur fallback tidak punya nama file dari kamera — buat nama sendiri.
      filename: downloaded.filename || (filename ? path.basename(filename) : `capture-${Date.now()}.jpg`),
      buffer: downloaded.buffer,
    };

    if (targetDir) {
      try {
        fs.mkdirSync(targetDir, { recursive: true });
        const filePath = path.join(targetDir, result.filename);
        fs.writeFileSync(filePath, downloaded.buffer);
        result.filePath = filePath;
      } catch (err) {
        // Foto sudah di tangan; kegagalan salin lokal tidak boleh membatalkan sesi.
        result.saveWarning = `Foto berhasil diambil tetapi gagal disalin ke folder sesi: ${err.message}`;
      }
    }

    return result;
  }

  async dispose() {
    this.disposed = true;
    this.liveViewActive = false;
    this._abortPending();
  }
}

module.exports = { DigiCamControlService, isCompleteJpeg };
