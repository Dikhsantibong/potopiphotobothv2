/**
 * ICameraProvider
 * ---------------
 * Kontrak bersama untuk semua sumber kamera photobooth.
 *
 * Dua implementasi:
 *  - WebcamProviderService  → membungkus flow getUserMedia yang sudah ada di renderer
 *  - DigiCamControlService  → berbicara HTTP ke digiCamControl Web Server
 *
 * Semua method mengembalikan objek biasa (bukan throw) supaya IPC handler tidak
 * perlu try/catch berlapis dan renderer selalu menerima bentuk yang sama.
 */
class ICameraProvider {
  constructor() {
    /** @type {string} identitas provider: 'webcam' | 'digicamcontrol' */
    this.name = 'unknown';
  }

  /**
   * Cek cepat apakah provider siap dipakai.
   * @returns {Promise<{connected: boolean, provider: string, error?: string}>}
   */
  async healthCheck() {
    throw new Error('healthCheck() belum diimplementasikan');
  }

  /**
   * Status lengkap (health check + info tambahan bila tersedia).
   * @returns {Promise<object>}
   */
  async getStatus() {
    throw new Error('getStatus() belum diimplementasikan');
  }

  /** @returns {Promise<{ok: boolean, error?: string}>} */
  async startLiveView() {
    throw new Error('startLiveView() belum diimplementasikan');
  }

  /** @returns {Promise<{ok: boolean, error?: string}>} */
  async stopLiveView() {
    throw new Error('stopLiveView() belum diimplementasikan');
  }

  /**
   * Ambil foto.
   * @returns {Promise<{ok: boolean, filePath?: string, dataUrl?: string, error?: string}>}
   */
  async capture() {
    throw new Error('capture() belum diimplementasikan');
  }

  /** @returns {Promise<{ok: boolean, filename: string|null}>} */
  async getLastCaptured() {
    throw new Error('getLastCaptured() belum diimplementasikan');
  }

  /** @returns {Promise<{ok: boolean, dataUrl?: string, error?: string}>} */
  async downloadPhoto() {
    throw new Error('downloadPhoto() belum diimplementasikan');
  }

  /**
   * Satu frame live view mentah. Hanya relevan untuk provider berbasis HTTP;
   * provider webcam mengembalikan RENDERER_OWNED karena frame-nya hidup di <video>.
   * @returns {Promise<{ok: boolean, buffer?: Buffer, mime?: string, error?: string}>}
   */
  async getFrame() {
    return { ok: false, code: 'NOT_SUPPORTED', error: 'Provider ini tidak menyediakan frame' };
  }

  /** Bersihkan semua resource (polling, koneksi HTTP pending, stream). */
  async dispose() {
    /* default: tidak ada resource */
  }
}

module.exports = { ICameraProvider };
