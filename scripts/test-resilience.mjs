/**
 * Uji ketahanan koneksi digiCamControl.
 *
 *   npm run test:resilience
 *
 * Menirukan gangguan nyata: web server tumbang di tengah sesi, proses yang
 * menggantung tanpa pernah menutup respons, dan digiCamControl yang hidup lagi
 * setelah beberapa detik.
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { DigiCamControlService } = require('../electron/camera/DigiCamControlService.js');

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };
const delay = (ms) => new Promise(r => setTimeout(r, ms));

const jpeg = () => {
  const b = Buffer.alloc(4096, 0x40);
  b[0] = 0xff; b[1] = 0xd8; b[b.length - 2] = 0xff; b[b.length - 1] = 0xd9;
  return b;
};

/** Server yang bisa dimatikan, dihidupkan, dan dibuat menggantung. */
function makeServer(port) {
  let mode = 'ok';            // 'ok' | 'hang'
  let lastCaptured = 'IMG_0001.JPG';
  let seq = 1;
  const sockets = new Set();

  const server = http.createServer((req, res) => {
    if (mode === 'hang') {
      // Kirim header lalu diam selamanya — socket tetap "hidup"
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write(' ');
      return;                 // sengaja tidak pernah res.end()
    }
    const u = req.url;
    const fin = (b, t = 'text/plain') => { res.writeHead(200, { 'Content-Type': t }); res.end(b); };
    if (u.includes('liveview.jpg')) return fin(jpeg(), 'image/jpeg');
    if (u.includes('lastcaptured')) return fin(lastCaptured);
    if (u.includes('/image/')) return fin(jpeg(), 'image/jpeg');
    if (u.includes('CMD=Capture')) {
      setTimeout(() => { seq++; lastCaptured = `IMG_000${seq}.JPG`; }, 300);
      return fin('OK');
    }
    fin('OK');
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });

  return {
    listen: () => new Promise(r => server.listen(port, '127.0.0.1', r)),
    kill: () => new Promise(r => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
    setMode: (m) => { mode = m; },
  };
}

const PORT = 5599;

(async () => {
  console.log('Uji ketahanan koneksi digiCamControl\n');

  // ── A. Server tumbang di tengah sesi
  console.log('[A] digiCamControl tumbang saat live view berjalan');
  {
    const srv = makeServer(PORT);
    await srv.listen();
    const svc = new DigiCamControlService({ baseUrl: `http://127.0.0.1:${PORT}` });
    await svc.startLiveView();
    check('live view menyala', svc.liveViewActive === true);

    await srv.kill();

    let lost = null;
    for (let i = 0; i < 8; i++) {
      const res = await svc.getFrame();
      if (res.code === 'LIVEVIEW_LOST') { lost = i + 1; break; }
    }
    check('kehilangan live view terdeteksi', lost !== null, `setelah ${lost} frame`);
    check('liveViewActive ditandai mati', svc.liveViewActive === false);
    await svc.dispose();
  }

  // ── B. Pulih otomatis setelah server hidup lagi
  console.log('\n[B] digiCamControl hidup lagi setelah beberapa detik');
  {
    const srv = makeServer(PORT);
    await srv.listen();
    const svc = new DigiCamControlService({ baseUrl: `http://127.0.0.1:${PORT}` });
    await svc.startLiveView();

    await srv.kill();
    for (let i = 0; i < 6; i++) await svc.getFrame();
    check('live view mati setelah server tumbang', svc.liveViewActive === false);

    const srv2 = makeServer(PORT);
    await srv2.listen();

    const again = await svc.startLiveView();
    check('startLiveView berhasil lagi tanpa restart aplikasi', again.ok === true, again.error || '');
    check('live view menyala kembali', svc.liveViewActive === true);

    const frame = await svc.getFrame();
    check('frame mengalir lagi', frame.ok === true);
    await svc.dispose(); await srv2.kill();
  }

  // ── C. Server menggantung (tidak pernah menutup respons)
  console.log('\n[C] Proses digiCamControl hang — respons tidak pernah ditutup');
  {
    const srv = makeServer(PORT);
    await srv.listen();
    const svc = new DigiCamControlService({ baseUrl: `http://127.0.0.1:${PORT}` });
    svc.liveViewActive = true;
    srv.setMode('hang');

    const started = Date.now();
    const res = await svc.fireShutter();
    const elapsed = Date.now() - started;
    check('shutter tidak menggantung selamanya', elapsed < 30000, `${elapsed}ms`);
    check('dilaporkan gagal, bukan diam', res.ok === false, res.code);
    await svc.dispose(); await srv.kill();
  }

  // ── D. Server mati saat menunggu file — menyerah lebih awal
  console.log('\n[D] Server tumbang saat menunggu foto');
  {
    const srv = makeServer(PORT);
    await srv.listen();
    const svc = new DigiCamControlService({ baseUrl: `http://127.0.0.1:${PORT}` });
    await svc.startLiveView();
    await svc.armCapture();
    await srv.kill();                       // tumbang tepat sebelum ambil file

    const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sesi-'));
    const started = Date.now();
    const got = await svc.collectPhoto({ sessionDir });
    const elapsed = Date.now() - started;
    check('gagal dengan jelas', got.ok === false, got.code);
    check('menyerah jauh sebelum batas 12 detik', elapsed < 7000, `${elapsed}ms`);
    check('live view ikut ditandai mati', svc.liveViewActive === false);
    await svc.dispose();
  }

  // ── E. armCapture tidak tersandera collect yang bermasalah
  console.log('\n[E] armCapture saat pengambilan file sebelumnya macet');
  {
    const svc = new DigiCamControlService({ baseUrl: `http://127.0.0.1:${PORT}` });
    svc.liveViewActive = true;
    svc.lastCollectedFilename = 'IMG_0009.JPG';
    svc._activeCollect = delay(60000);      // collect yang tidak selesai-selesai
    svc.getLastCaptured = async () => ({ ok: true, filename: 'IMG_0009.JPG' });

    const started = Date.now();
    await svc.armCapture();
    const elapsed = Date.now() - started;
    check('tidak menunggu lebih dari ~3 detik', elapsed < 4000, `${elapsed}ms`);
    check('baseline tetap terisi', svc.armedBaseline === 'IMG_0009.JPG');
    await svc.dispose();
  }

  console.log(`\nHasil: ${pass} lulus, ${fail} gagal`);
  process.exit(fail ? 1 : 0);
})();
