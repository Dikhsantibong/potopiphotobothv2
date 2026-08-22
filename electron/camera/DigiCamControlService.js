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
const http = require('http');
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
    this.imageQuality = options.imageQuality || '';
    // 'CaptureNoAf' = shutter jatuh seketika; 'Capture' = autofokus dulu (ada jeda).
    this.shutterCommand = options.shutterCommand === 'Capture' ? 'Capture' : 'CaptureNoAf';
    // Dipanggil setelah perintah yang memunculkan jendela GUI digiCamControl,
    // agar jendela photobooth bisa direbut kembali ke depan.
    this.onWindowRaised = typeof options.onWindowRaised === 'function' ? options.onWindowRaised : null;
    this.liveViewActive = false;
    /** Nama file terakhir sebelum shutter — diambil saat arm, bukan saat jepret. */
    this.armedBaseline = null;
    this.armed = false;
    this.disposed = false;
    /** @type {Set<AbortController>} semua request HTTP yang masih menggantung */
    this.pending = new Set();
    /**
     * Subset dari `pending` yang khusus berisi request frame live view.
     * Dipisahkan supaya membersihkan antrean live view tidak ikut membatalkan
     * unduhan foto yang sedang berjalan di latar belakang.
     * @type {Set<AbortController>}
     */
    this.frameControllers = new Set();
    /** Sidik jari foto terakhir, dipakai fallback agar tidak mengambil foto duplikat. */
    this.lastCaptureSignature = null;
    /** Promise startLiveView yang sedang berjalan — mencegah perintah ganda. */
    this._startingLiveView = null;
    /** Kualitas foto cukup dikirim sekali per sesi provider. */
    this.qualityApplied = false;
  }

  static signature(buffer) {
    return `${buffer.length}:${buffer.subarray(0, 64).toString('hex')}`;
  }

  // ── HTTP helpers ────────────────────────────────────────────
  async _fetch(suffix, { timeout = 4000, raw = false, kind = 'data' } = {}) {
    if (this.disposed) throw new Error('Provider digiCamControl sudah dihentikan');
    const controller = new AbortController();
    this.pending.add(controller);
    if (kind === 'frame') this.frameControllers.add(controller);
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
      this.frameControllers.delete(controller);
    }
  }

  /**
   * GET dengan koneksi sendiri (agent: false, Connection: close).
   *
   * Perintah CMD TIDAK boleh ikut memakai connection pool milik global fetch.
   * Pool itu dipakai bersama request frame live view, dan membatalkan salah satu
   * request bisa merusak socket yang sedang dipakai — request berikutnya lalu
   * gagal dengan "fetch failed" (ECONNRESET) meski digiCamControl sehat.
   */
  _httpGet(suffix, { timeout = 4000 } = {}) {
    if (this.disposed) return Promise.reject(new Error('Provider digiCamControl sudah dihentikan'));

    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + suffix);
      const req = http.get(
        {
          hostname: url.hostname,
          port: url.port || 80,
          path: url.pathname + url.search,
          agent: false,
          headers: { Connection: 'close' },
          timeout,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              ok: res.statusCode >= 200 && res.statusCode < 400,
              text: Buffer.concat(chunks).toString('utf-8'),
            })
          );
          res.on('error', reject);
        }
      );

      req.on('timeout', () => {
        const err = new Error('timeout');
        err.code = 'ETIMEDOUT';
        req.destroy(err);
      });
      req.on('error', reject);
    });
  }

  _cmd(cmd, opts) {
    return this._httpGet(`/?CMD=${encodeURIComponent(cmd)}`, opts);
  }

  /**
   * Perintah yang membuka jendela digiCamControl (Live View, preview capture).
   * Setelah dijalankan, jendela photobooth diangkat kembali ke depan.
   */
  async _cmdRaisingWindow(cmd, opts) {
    try {
      return await this._cmd(cmd, opts);
    } finally {
      // Dipanggil juga saat perintah gagal: jendela bisa terlanjur muncul.
      try {
        this.onWindowRaised?.();
      } catch {
        /* jangan sampai mengganggu alur capture */
      }
    }
  }

  /**
   * Bersihkan HANYA antrean frame live view.
   *
   * Membatalkan seluruh `pending` di sini akan ikut membunuh unduhan foto yang
   * sedang berjalan di latar belakang untuk frame sebelumnya.
   */
  _abortFrames() {
    for (const controller of this.frameControllers) {
      try {
        controller.abort();
      } catch {
        /* sudah selesai */
      }
      this.pending.delete(controller);
    }
    this.frameControllers.clear();
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
    this.frameControllers.clear();
  }

  _describeError(err) {
    if (err && err.name === 'AbortError') return 'timeout';
    const code = err && (err.code || err.cause?.code);
    if (code === 'ECONNREFUSED') return 'koneksi ditolak — digiCamControl tidak berjalan';
    if (code === 'ECONNRESET' || code === 'EPIPE') return 'koneksi terputus';
    if (code === 'ETIMEDOUT') return 'timeout';
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

  /**
   * Minta kamera memakai ukuran JPEG tertentu (mis. "Medium Fine JPEG").
   * Nama property berbeda antar model kamera, jadi ini best-effort: kegagalan
   * tidak pernah membatalkan live view atau capture.
   */
  async setImageQuality(value) {
    this.qualityApplied = true;
    if (!value) return { ok: true, skipped: true };
    try {
      const res = await this._fetch(
        `/?slc=set&param1=compressionsetting&param2=${encodeURIComponent(value)}`,
        { timeout: 4000 }
      );
      const text = (res.text || '').trim();
      const applied = res.ok && !/error|unknown|not\s*found/i.test(text);
      if (!applied) {
        console.warn(`[digiCamControl] Kualitas "${value}" tidak diterima kamera: ${text || `HTTP ${res.status}`}`);
      }
      return { ok: applied, value, response: text };
    } catch (err) {
      console.warn(`[digiCamControl] Gagal set kualitas foto: ${this._describeError(err)}`);
      return { ok: false, value, error: this._describeError(err) };
    }
  }

  /**
   * Idempoten dan aman dipanggil berulang.
   *
   * Halaman kamera memanggil ini lagi setiap ULANGI/LANJUT. Tanpa penjagaan,
   * setiap panggilan mengirim LiveViewWnd_Show baru sementara frame loop tetap
   * memoll /liveview.jpg. Web server digiCamControl melayani request secara
   * berurutan, jadi perintah Show terjebak di belakang antrean frame dan
   * berakhir timeout — padahal live view-nya sudah jalan.
   */
  async startLiveView() {
    if (this._startingLiveView) return this._startingLiveView;
    this._startingLiveView = this._doStartLiveView().finally(() => {
      this._startingLiveView = null;
    });
    return this._startingLiveView;
  }

  async _doStartLiveView() {
    // Live view sudah jalan? Buktikan dengan satu frame, jangan kirim perintah
    // apa pun. Ini jalur yang dipakai ULANGI/LANJUT.
    if (this.liveViewActive) {
      try {
        const frame = await this._fetch(`/liveview.jpg?t=${Date.now()}`, {
          timeout: 2500,
          raw: true,
          kind: 'frame',
        });
        if (frame.ok && frame.buffer.length > 1024) {
          return { ok: true, connected: true, provider: this.name, reused: true };
        }
      } catch {
        /* live view ternyata mati — lanjut ke start penuh */
      }
      this.liveViewActive = false;
    }

    const health = await this.healthCheck();
    if (!health.connected) return { ok: false, ...health };

    // Cukup sekali per sesi; mengirimnya tiap kali menambah antrean di server.
    if (this.imageQuality && !this.qualityApplied) {
      await this.setImageQuality(this.imageQuality);
      this.qualityApplied = true;
    }

    try {
      // Perintah ini membuka jendela GUI dan menginisialisasi live view PTP di
      // kamera (mirror, autofokus awal). Start dingin bisa lewat dari 5 detik.
      await this._cmdRaisingWindow('LiveViewWnd_Show', { timeout: 12000 });
    } catch (err) {
      return {
        ok: false,
        connected: false,
        provider: this.name,
        error:
          `Gagal memulai live view: ${this._describeError(err)}. ` +
          `digiCamControl tidak menjawab perintah Live View — pastikan kamera menyala, ` +
          `terhubung USB, dan tidak sedang dipakai aplikasi lain.`,
      };
    }

    // Live view butuh waktu untuk menghasilkan frame pertama.
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline && !this.disposed) {
      try {
        const frame = await this._fetch(`/liveview.jpg?t=${Date.now()}`, { timeout: 2500, raw: true, kind: 'frame' });
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
    this._abortFrames();
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
      const frame = await this._fetch(`/liveview.jpg?t=${Date.now()}`, { timeout: 2500, raw: true, kind: 'frame' });
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
   * Siapkan segalanya SEBELUM momen jepret, dipanggil saat countdown mulai.
   *
   * Semua pekerjaan yang bisa menunda shutter dikerjakan di sini: memastikan
   * live view hidup, mengambil baseline `lastcaptured`, dan menyuruh kamera
   * fokus. Dengan begitu fireShutter() nanti benar-benar hanya satu request.
   */
  async armCapture() {
    if (!this.liveViewActive) {
      const lv = await this.startLiveView();
      if (!lv.ok) return { ok: false, code: 'LIVEVIEW_FAILED', error: lv.error };
    }

    try {
      this.armedBaseline = (await this.getLastCaptured()).filename;
    } catch {
      this.armedBaseline = null;
    }

    // Fokus dilakukan sekarang, selama user masih menunggu countdown, supaya
    // shutter nanti tidak perlu menunggu autofokus. Best-effort.
    if (this.shutterCommand === 'CaptureNoAf') {
      this._cmd('LiveViewWnd_Focus', { timeout: 3000 }).catch(() => { });
    }

    this.armed = true;
    return { ok: true, baseline: this.armedBaseline };
  }

  /**
   * Momen jepret. Hanya satu request, tanpa persiapan apa pun, supaya foto
   * jatuh tepat di akhir countdown.
   */
  async fireShutter() {
    const startedAt = Date.now();

    // Bebaskan antrean /liveview.jpg agar request shutter tidak mengantre.
    // Sengaja HANYA frame: unduhan foto frame sebelumnya bisa saja masih
    // berjalan di latar belakang dan tidak boleh ikut dibatalkan.
    this._abortFrames();

    if (!this.armed) {
      // Dipanggil tanpa arm (mis. dari alur lama) — ambil baseline seadanya.
      try {
        this.armedBaseline = (await this.getLastCaptured()).filename;
      } catch {
        this.armedBaseline = null;
      }
    }

    // Shutter adalah operasi paling kritis dalam sesi: kegagalan koneksi sesaat
    // tidak boleh langsung membatalkan pose. Timeout TIDAK diulang, karena di
    // situ perintah kemungkinan sudah sampai dan kamera sedang memotret.
    const MAX_ATTEMPTS = 3;
    let lastError = null;

    try {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          await this._cmd(this.shutterCommand, { timeout: 8000 });
          this.armed = false;
          return {
            ok: true,
            command: this.shutterCommand,
            attempts: attempt,
            elapsed: Date.now() - startedAt,
          };
        } catch (err) {
          lastError = err;
          const code = err && (err.code || err.cause?.code);
          const retryable = code === 'ECONNRESET' || code === 'EPIPE' || code === 'ECONNABORTED';
          if (!retryable || attempt === MAX_ATTEMPTS) break;
          console.warn(
            `[digiCamControl] Shutter percobaan ${attempt} gagal (${code}) — mencoba lagi`
          );
          await delay(120);
        }
      }

      this.armed = false;
      return {
        ok: false,
        code: 'CAPTURE_FAILED',
        error:
          `Shutter gagal dipicu: ${this._describeError(lastError)}. ` +
          `Ini kegagalan koneksi ke digiCamControl, bukan kamera — pastikan digiCamControl masih berjalan.`,
      };
    } finally {
      // Jendela digiCamControl bisa terlanjur muncul walau perintahnya gagal.
      try {
        this.onWindowRaised?.();
      } catch {
        /* jangan ganggu alur capture */
      }
    }
  }

  /**
   * Ambil file hasil jepretan. Dijalankan SETELAH shutter, jadi durasinya tidak
   * lagi menggeser momen foto — hanya menunda tampilnya preview.
   */
  async collectPhoto({ sessionDir, timeoutMs = 12000, pollIntervalMs = 250 } = {}) {
    const targetDir = sessionDir || this.sessionDir;
    const before = this.armedBaseline;

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
    this._cmdRaisingWindow('LiveViewWnd_Show', { timeout: 4000 }).catch(() => { });

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

  /**
   * Alur lengkap dalam satu panggilan. Tetap disediakan agar pemanggil yang
   * tidak memisahkan arm/fire/collect (mis. test) tetap bekerja.
   */
  async capture(options = {}) {
    const armed = await this.armCapture();
    if (!armed.ok) return armed;

    const fired = await this.fireShutter();
    if (!fired.ok) return fired;

    return this.collectPhoto(options);
  }

  async dispose() {
    this.disposed = true;
    this.liveViewActive = false;
    this.armed = false;
    this._startingLiveView = null;
    this._abortPending();
  }
}

module.exports = { DigiCamControlService, isCompleteJpeg };
