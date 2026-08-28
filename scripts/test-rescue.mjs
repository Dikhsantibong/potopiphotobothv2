/**
 * Uji penyelamatan foto dari folder sesi + pembersihan arsip lama.
 *
 *   npm run test:rescue
 *
 * digiCamControl menulis hasil jepretan ke folder yang KITA tentukan lewat
 * session.folder. Jadi begitu file ada di disk, foto itu milik kita — walaupun
 * web server-nya tumbang tepat setelah shutter.
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { DigiCamControlService } = require('../electron/camera/DigiCamControlService.js');
const { CameraProviderManager } = require('../electron/camera/CameraProviderManager.js');

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };
const delay = (ms) => new Promise(r => setTimeout(r, ms));

const jpeg = (fill) => {
  const b = Buffer.alloc(8192, fill);
  b[0] = 0xff; b[1] = 0xd8; b[b.length - 2] = 0xff; b[b.length - 1] = 0xd9;
  return b;
};

const PORT = 5601;

(async () => {
  console.log('Uji penyelamatan foto dari folder sesi\n');

  // ── A. Server tumbang tepat setelah menulis file
  console.log('[A] digiCamControl menulis file lalu langsung tumbang');
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rescue-a-'));
    const sockets = new Set();
    const server = http.createServer((req, res) => {
      if (req.url.includes('CMD=Capture')) {
        // Tulis file ke folder sesi (seperti digiCamControl), lalu mati
        setTimeout(() => {
          fs.writeFileSync(path.join(dir, 'IMG_0042.JPG'), jpeg(0x55));
          for (const s of sockets) s.destroy();
          server.close();
        }, 200);
        res.writeHead(200); return res.end('OK');
      }
      if (req.url.includes('lastcaptured')) { res.writeHead(200); return res.end('IMG_0001.JPG'); }
      res.writeHead(200); res.end('OK');
    });
    server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
    await new Promise(r => server.listen(PORT, '127.0.0.1', r));

    const svc = new DigiCamControlService({ baseUrl: `http://127.0.0.1:${PORT}` });
    svc.liveViewActive = true;
    svc.armedBaseline = 'IMG_0001.JPG';

    await svc.fireShutter();
    const got = await svc.collectPhoto({ sessionDir: dir });

    check('foto TETAP terselamatkan', got.ok === true, got.error || `dari ${got.filename}`);
    check('diambil dari disk, bukan HTTP', got.filePath === path.join(dir, 'IMG_0042.JPG'), got.filePath || '-');
    check('isinya utuh', got.buffer && got.buffer.length === 8192, `${got.buffer?.length} byte`);
    await svc.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── B. Tidak mengambil ulang foto frame sebelumnya
  console.log('\n[B] File lama di folder tidak boleh dianggap foto baru');
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rescue-b-'));
    const old = jpeg(0x33);
    fs.writeFileSync(path.join(dir, 'IMG_0001.JPG'), old);

    const svc = new DigiCamControlService({ baseUrl: `http://127.0.0.1:${PORT}` });
    svc.lastCaptureSignature = DigiCamControlService.signature(old);
    svc.lastShutterAt = Date.now();

    check('foto yang sudah dipakai diabaikan', svc._findPhotoOnDisk(dir, svc.lastShutterAt) === null);

    // File baru muncul → harus terdeteksi
    await delay(50);
    fs.writeFileSync(path.join(dir, 'IMG_0002.JPG'), jpeg(0x77));
    const found = svc._findPhotoOnDisk(dir, svc.lastShutterAt);
    check('foto baru terdeteksi', found !== null, found?.filename);

    await svc.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── C. File yang masih ditulis ditolak
  console.log('\n[C] File JPEG yang belum selesai ditulis');
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rescue-c-'));
    const partial = Buffer.alloc(8192, 0x11);
    partial[0] = 0xff; partial[1] = 0xd8;   // ada SOI, tanpa EOI
    fs.writeFileSync(path.join(dir, 'IMG_0003.JPG'), partial);

    const svc = new DigiCamControlService({ baseUrl: `http://127.0.0.1:${PORT}` });
    svc.lastShutterAt = Date.now() - 100;
    check('JPEG tanpa penanda akhir ditolak', svc._findPhotoOnDisk(dir, svc.lastShutterAt) === null);
    await svc.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── D. Pembersihan arsip sesi lama
  console.log('\n[D] Folder sesi lama dibersihkan otomatis');
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rescue-d-'));
    const mgr = new CameraProviderManager({ sessionRoot: root });

    const old = 20 * 24 * 60 * 60 * 1000;      // 20 hari lalu
    for (let i = 0; i < 5; i++) {
      const d = path.join(root, `lama-${i}`);
      fs.mkdirSync(d);
      fs.writeFileSync(path.join(d, 'foto.jpg'), jpeg(i));
      const t = new Date(Date.now() - old);
      fs.utimesSync(d, t, t);
    }
    for (let i = 0; i < 3; i++) fs.mkdirSync(path.join(root, `baru-${i}`));

    const before = fs.readdirSync(root).length;
    const res = mgr.pruneOldSessions({ keepDays: 7, keepMax: 200 });
    const after = fs.readdirSync(root);

    check('folder lama terhapus', res.removed === 5, `dihapus ${res.removed} dari ${before}`);
    check('folder baru dipertahankan', after.length === 3, after.join(', '));

    // Batas jumlah
    for (let i = 0; i < 10; i++) fs.mkdirSync(path.join(root, `sesi-${i}`));
    mgr.pruneOldSessions({ keepDays: 365, keepMax: 5 });
    check('batas jumlah sesi dihormati', fs.readdirSync(root).length === 5, `${fs.readdirSync(root).length} tersisa`);

    // Sesi yang sedang berjalan tidak boleh disentuh
    const active = path.join(root, 'sedang-jalan');
    fs.mkdirSync(active);
    mgr.currentSessionDir = active;
    mgr.pruneOldSessions({ keepDays: 0, keepMax: 0 });
    check('sesi yang sedang berjalan tidak dihapus', fs.existsSync(active));

    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log(`\nHasil: ${pass} lulus, ${fail} gagal`);
  process.exit(fail ? 1 : 0);
})();
