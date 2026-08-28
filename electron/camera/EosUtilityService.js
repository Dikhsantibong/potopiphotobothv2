/**
 * EosUtilityService
 * -----------------
 * Provider untuk Canon EOS Utility (software resmi Canon).
 *
 * BATASAN PENTING — dikonfirmasi Canon sendiri:
 * EOS Utility TIDAK memiliki API, web server, maupun antarmuka command line.
 * Karena itu provider ini bekerja lewat satu-satunya jalur yang tersedia:
 * memantau folder tempat EOS Utility menyimpan hasil Remote Shooting.
 *
 * Konsekuensinya:
 *   - Live view  : TIDAK tersedia (EOS Utility hanya menampilkannya di
 *                  jendelanya sendiri). UI menampilkan panduan, bukan preview.
 *   - Shutter    : tidak bisa dipicu lewat API. Dua mode disediakan —
 *                  'manual'    : aplikasi menunggu foto muncul di folder,
 *                                dipicu remote shutter fisik atau operator.
 *                  'keystroke' : mengirim tombol ke jendela EOS Utility.
 *                                EKSPERIMENTAL, bergantung versi & bahasa UI.
 *   - Ambil foto : ANDAL — file dibaca langsung dari disk, tanpa HTTP.
 *
 * Provider ini sengaja berdiri sendiri dan tidak berbagi kode dengan
 * DigiCamControlService, supaya jalur digiCamControl yang sudah stabil tidak
 * ikut berubah.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { ICameraProvider } = require('./ICameraProvider');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** JPEG utuh diawali FFD8 dan diakhiri FFD9 — menolak file yang masih ditulis. */
function isCompleteJpeg(buffer) {
  if (!buffer || buffer.length < 1024) return false;
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return false;
  return buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
}

/** Nama proses EOS Utility berbeda antar versi; semuanya dianggap sah. */
const PROCESS_NAMES = ['EOS Utility.exe', 'EOSUtility.exe', 'EOS Utility 2.exe'];

class EosUtilityService extends ICameraProvider {
  constructor(options = {}) {
    super();
    this.name = 'eosutility';

    /** Folder tempat EOS Utility menyimpan hasil Remote Shooting. */
    this.watchFolder = options.watchFolder || '';
    /** 'manual' (default, aman) atau 'keystroke' (eksperimental). */
    this.shutterMode = options.shutterMode === 'keystroke' ? 'keystroke' : 'manual';
    /** Berapa lama menunggu foto muncul setelah countdown selesai. */
    this.captureTimeoutMs = options.captureTimeoutMs || 20000;

    this.disposed = false;
    this.armed = false;
    /** Patokan waktu: file yang lebih baru dari ini dianggap hasil jepretan. */
    this.lastShutterAt = 0;
    /** File yang sudah dipakai untuk suatu frame — jangan diambil dua kali. */
    this._consumedFiles = new Set();
    /** Sidik jari foto terakhir, pertahanan tambahan terhadap duplikat. */
    this.lastCaptureSignature = null;
  }

  static signature(buffer) {
    return `${buffer.length}:${buffer.subarray(0, 64).toString('hex')}`;
  }

  // ── Pemeriksaan lingkungan ──────────────────────────────────
  /** Apakah proses EOS Utility sedang berjalan di Windows. */
  _isProcessRunning() {
    return new Promise((resolve) => {
      if (process.platform !== 'win32') return resolve(null); // tidak relevan
      execFile('tasklist', ['/FO', 'CSV', '/NH'], { timeout: 5000 }, (err, stdout) => {
        if (err) return resolve(null); // tidak bisa dipastikan
        const haystack = (stdout || '').toLowerCase();
        resolve(PROCESS_NAMES.some((n) => haystack.includes(n.toLowerCase())));
      });
    });
  }

  async healthCheck() {
    if (!this.watchFolder) {
      return {
        connected: false,
        provider: this.name,
        error:
          'Folder simpan EOS Utility belum diatur. Buka Settings → Sumber Kamera → ' +
          'Folder Simpan EOS Utility, dan isi dengan folder yang sama seperti di ' +
          'EOS Utility → Preferences → Destination Folder.',
      };
    }

    let stat;
    try {
      stat = fs.statSync(this.watchFolder);
    } catch {
      return {
        connected: false,
        provider: this.name,
        error: `Folder simpan tidak ditemukan: ${this.watchFolder}`,
      };
    }

    if (!stat.isDirectory()) {
      return {
        connected: false,
        provider: this.name,
        error: `Path bukan sebuah folder: ${this.watchFolder}`,
      };
    }

    // Folder yang siap dibaca sudah cukup untuk dianggap terhubung. Proses
    // EOS Utility dilaporkan sebagai info tambahan saja, karena nama prosesnya
    // berbeda antar versi dan tidak layak dijadikan syarat mutlak.
    const running = await this._isProcessRunning();

    return {
      connected: true,
      provider: this.name,
      watchFolder: this.watchFolder,
      shutterMode: this.shutterMode,
      processRunning: running,
      // Live view memang tidak pernah tersedia lewat EOS Utility.
      liveViewSupported: false,
      warning:
        running === false
          ? 'EOS Utility sepertinya belum berjalan. Buka EOS Utility dan masuk ke Remote Shooting.'
          : undefined,
    };
  }

  async getStatus() {
    const health = await this.healthCheck();
    let recentFiles = 0;
    if (health.connected) {
      try {
        recentFiles = fs
          .readdirSync(this.watchFolder)
          .filter((f) => /\.jpe?g$/i.test(f)).length;
      } catch {
        /* abaikan */
      }
    }
    return { ...health, liveViewActive: false, photosInFolder: recentFiles };
  }

  // ── Live view: tidak tersedia ───────────────────────────────
  async startLiveView() {
    // Bukan kegagalan: ini memang batas EOS Utility. Dilaporkan ok supaya
    // halaman kamera tetap bisa lanjut ke countdown dan capture.
    return {
      ok: true,
      connected: true,
      provider: this.name,
      liveViewSupported: false,
      note: 'EOS Utility tidak menyediakan live view untuk aplikasi lain.',
    };
  }

  async stopLiveView() {
    return { ok: true, provider: this.name };
  }

  async getFrame() {
    return {
      ok: false,
      code: 'NOT_SUPPORTED',
      error: 'EOS Utility tidak menyediakan frame live view',
    };
  }

  // ── Pencarian foto di folder simpan ────────────────────────
  /**
   * Cari foto baru di folder simpan EOS Utility.
   * @param {number} sinceMs abaikan file yang lebih lama dari ini
   */
  _findPhoto(sinceMs) {
    if (!this.watchFolder) return null;

    let entries;
    try {
      entries = fs.readdirSync(this.watchFolder, { withFileTypes: true });
    } catch {
      return null;
    }

    let best = null;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/\.jpe?g$/i.test(entry.name)) continue;

      const filePath = path.join(this.watchFolder, entry.name);
      if (this._consumedFiles.has(filePath)) continue;

      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }
      // Toleransi kecil untuk selisih jam file vs jam proses.
      if (stat.mtimeMs < sinceMs - 500) continue;
      if (stat.size < 1024) continue; // masih ditulis

      if (!best || stat.mtimeMs > best.mtimeMs) {
        best = { filePath, name: entry.name, mtimeMs: stat.mtimeMs };
      }
    }

    if (!best) return null;

    let buffer;
    try {
      buffer = fs.readFileSync(best.filePath);
    } catch {
      return null; // sedang ditulis atau terkunci
    }
    if (!isCompleteJpeg(buffer)) return null;
    if (EosUtilityService.signature(buffer) === this.lastCaptureSignature) return null;

    return { buffer, filename: best.name, filePath: best.filePath };
  }

  /**
   * Catat semua foto yang SUDAH ada di folder sebagai "sudah dipakai".
   *
   * Mengandalkan waktu modifikasi saja tidak cukup: foto dari jepretan
   * sebelumnya bisa punya mtime hanya beberapa milidetik lebih tua dari
   * shutter berikutnya, lalu ikut terpungut. Snapshot ini menjadi baseline
   * yang setara dengan `lastcaptured` pada digiCamControl.
   */
  _snapshotExisting() {
    if (!this.watchFolder) return 0;
    let entries;
    try {
      entries = fs.readdirSync(this.watchFolder, { withFileTypes: true });
    } catch {
      return 0;
    }
    let n = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/.jpe?g$/i.test(entry.name)) continue;
      this._consumedFiles.add(path.join(this.watchFolder, entry.name));
      n++;
    }
    return n;
  }

  // ── Alur jepret ─────────────────────────────────────────────
  async armCapture() {
    const health = await this.healthCheck();
    if (!health.connected) {
      return { ok: false, code: 'NOT_READY', error: health.error };
    }
    // Baseline: apa pun yang sudah ada di folder BUKAN hasil jepretan ini.
    const existing = this._snapshotExisting();

    this.armed = true;
    return { ok: true, mode: this.shutterMode, baselineFiles: existing };
  }

  /**
   * Kirim tombol ke jendela EOS Utility.
   *
   * EKSPERIMENTAL. Canon tidak menyediakan cara resmi, jadi ini mengandalkan
   * jendela Remote Shooting yang menerima keystroke. Bisa gagal karena versi,
   * bahasa antarmuka, atau jendela yang tidak aktif — kegagalannya sengaja
   * tidak membatalkan sesi, karena foto tetap bisa dipicu manual.
   */
  _sendKeystroke() {
    return new Promise((resolve) => {
      if (process.platform !== 'win32') {
        return resolve({ ok: false, error: 'Hanya didukung di Windows' });
      }

      const script = [
        '$ErrorActionPreference = "SilentlyContinue"',
        'Add-Type -AssemblyName Microsoft.VisualBasic',
        'Add-Type -AssemblyName System.Windows.Forms',
        '$proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*EOS Utility*" } | Select-Object -First 1',
        'if ($null -eq $proc) { Write-Output "NOTFOUND"; exit 0 }',
        '[Microsoft.VisualBasic.Interaction]::AppActivate($proc.Id)',
        'Start-Sleep -Milliseconds 120',
        '[System.Windows.Forms.SendKeys]::SendWait(" ")',
        'Write-Output "SENT"',
      ].join('; ');

      execFile(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { timeout: 6000, windowsHide: true },
        (err, stdout) => {
          if (err) return resolve({ ok: false, error: err.message });
          const out = (stdout || '').trim();
          if (out.includes('NOTFOUND')) {
            return resolve({ ok: false, error: 'Jendela EOS Utility tidak ditemukan' });
          }
          resolve({ ok: out.includes('SENT') });
        }
      );
    });
  }

  async fireShutter() {
    const startedAt = Date.now();
    // Dicatat SEBELUM apa pun, supaya file yang muncul sesudah ini dikenali
    // sebagai hasil jepretan ini.
    this.lastShutterAt = startedAt;

    // Dipanggil tanpa arm (mis. alur capture() ringkas): ambil baseline di sini
    // supaya foto lama di folder tidak ikut terpungut.
    if (!this.armed) this._snapshotExisting();
    this.armed = false;

    if (this.shutterMode === 'keystroke') {
      const sent = await this._sendKeystroke();
      if (!sent.ok) {
        console.warn(`[EOS Utility] Keystroke shutter gagal (${sent.error}) — menunggu pemicu manual`);
      }
      return {
        ok: true,
        command: 'keystroke',
        keystrokeDelivered: sent.ok,
        elapsed: Date.now() - startedAt,
      };
    }

    // Mode manual: aplikasi tidak memicu apa pun. Foto dipicu remote shutter
    // fisik atau operator, lalu ditangkap oleh collectPhoto dari folder.
    return { ok: true, command: 'manual', elapsed: Date.now() - startedAt };
  }

  async collectPhoto({ sessionDir, timeoutMs, pollIntervalMs = 300 } = {}) {
    const limit = timeoutMs || this.captureTimeoutMs;
    const deadline = Date.now() + limit;

    let found = null;
    let polls = 0;
    while (Date.now() < deadline && !this.disposed) {
      found = this._findPhoto(this.lastShutterAt);
      if (found) break;
      polls++;
      await delay(pollIntervalMs);
    }

    if (!found) {
      console.warn(
        `[EOS Utility] Foto tidak muncul di folder setelah ${limit}ms ` +
        `(${polls} kali cek, folder="${this.watchFolder}")`
      );
      return {
        ok: false,
        code: 'CAPTURE_TIMEOUT',
        error:
          this.shutterMode === 'manual'
            ? 'Tidak ada foto baru di folder EOS Utility. Pastikan shutter ditekan dan ' +
              'EOS Utility menyimpan ke folder yang sama dengan pengaturan aplikasi.'
            : 'EOS Utility tidak menghasilkan foto baru. Coba mode shutter Manual dengan ' +
              'remote shutter fisik, atau periksa jendela Remote Shooting.',
      };
    }

    this._consumedFiles.add(found.filePath);
    this.lastCaptureSignature = EosUtilityService.signature(found.buffer);
    // Batasi supaya tidak menumpuk pada mesin yang menyala berhari-hari.
    if (this._consumedFiles.size > 500) this._consumedFiles.clear();

    const result = {
      ok: true,
      provider: this.name,
      filename: found.filename,
      buffer: found.buffer,
      filePath: found.filePath,
    };

    // Salin ke folder sesi photobooth bila berbeda dari folder EOS Utility.
    if (sessionDir && path.resolve(sessionDir) !== path.resolve(this.watchFolder)) {
      try {
        fs.mkdirSync(sessionDir, { recursive: true });
        const copyPath = path.join(sessionDir, found.filename);
        fs.writeFileSync(copyPath, found.buffer);
        result.filePath = copyPath;
      } catch (err) {
        // Foto sudah di tangan; gagal menyalin tidak boleh membatalkan sesi.
        result.saveWarning = `Foto diambil tetapi gagal disalin ke folder sesi: ${err.message}`;
      }
    }

    return result;
  }

  async getLastCaptured() {
    const found = this._findPhoto(0);
    return { ok: true, filename: found ? found.filename : null };
  }

  async downloadPhoto(filename) {
    if (!filename || !this.watchFolder) {
      return { ok: false, error: 'Nama file atau folder tidak tersedia' };
    }
    try {
      const filePath = path.join(this.watchFolder, path.basename(filename));
      const buffer = fs.readFileSync(filePath);
      if (!isCompleteJpeg(buffer)) {
        return { ok: false, error: 'File JPG belum selesai ditulis' };
      }
      return { ok: true, buffer, filename: path.basename(filename) };
    } catch (err) {
      return { ok: false, error: `Gagal membaca file: ${err.message}` };
    }
  }

  /** Alur lengkap dalam satu panggilan, untuk pemanggil yang tidak memisahkannya. */
  async capture(options = {}) {
    const armed = await this.armCapture();
    if (!armed.ok) return armed;
    const fired = await this.fireShutter();
    if (!fired.ok) return fired;
    return this.collectPhoto(options);
  }

  async dispose() {
    this.disposed = true;
    this.armed = false;
    this._consumedFiles.clear();
  }
}

module.exports = { EosUtilityService, isCompleteJpeg };
