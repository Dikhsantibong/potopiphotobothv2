// Uji perbaikan fireShutter terhadap server tiruan digiCamControl.
import { createRequire } from 'node:module';
import http from 'node:http';
const require = createRequire(import.meta.url);
const { DigiCamControlService } = require('../electron/camera/DigiCamControlService.js');

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

// Server yang menjatuhkan koneksi pada N request CMD pertama (meniru socket rusak)
function makeServer(dropFirst) {
  let cmdSeen = 0;
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    if (req.url.includes('CMD=')) {
      cmdSeen++;
      if (cmdSeen <= dropFirst) { req.socket.destroy(); return; }
    }
    if (req.url.includes('liveview.jpg') || req.url.includes('/image/')) {
      // respons lambat: meniru frame live view dan unduhan foto yang masih berjalan
      setTimeout(() => { res.writeHead(200); res.end(Buffer.alloc(2048)); }, 3000);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  });
  return { server, hits, cmdCount: () => cmdSeen };
}

const listen = (s) => new Promise(r => s.listen(0, '127.0.0.1', () => r(s.address().port)));

(async () => {
  console.log('Uji ketahanan fireShutter terhadap koneksi putus\n');

  // ── A. Koneksi diputus 2x, shutter harus tetap berhasil
  console.log('[A] Socket diputus pada 2 percobaan pertama');
  {
    const { server, cmdCount } = makeServer(2);
    const port = await listen(server);
    const svc = new DigiCamControlService({ baseUrl: `http://127.0.0.1:${port}` });
    svc.liveViewActive = true;
    const res = await svc.fireShutter();
    check('shutter akhirnya berhasil', res.ok === true, res.error || '');
    check('dilakukan 3 percobaan', res.attempts === 3, `attempts=${res.attempts}`);
    check('server menerima 3 perintah CMD', cmdCount() === 3, `cmd=${cmdCount()}`);
    await svc.dispose(); server.close();
  }

  // ── B. Unduhan latar belakang tidak boleh ikut dibatalkan
  console.log('\n[B] Unduhan foto latar belakang saat shutter berikutnya');
  {
    const { server } = makeServer(0);
    const port = await listen(server);
    const svc = new DigiCamControlService({ baseUrl: `http://127.0.0.1:${port}` });
    svc.liveViewActive = true;

    // Request data (meniru unduhan foto) + request frame live view
    const dataTask = svc._fetch('/image/foto.jpg', { timeout: 8000, raw: true });
    const frameTask = svc._fetch('/liveview.jpg?t=1', { timeout: 8000, raw: true, kind: 'frame' }).catch(e => e);
    await new Promise(r => setTimeout(r, 100));
    check('frame terdaftar terpisah', svc.frameControllers.size === 1, `frames=${svc.frameControllers.size}`);
    check('pending berisi keduanya', svc.pending.size === 2, `pending=${svc.pending.size}`);

    await svc.fireShutter();
    const frameResult = await frameTask;
    check('request frame dibatalkan', frameResult instanceof Error, frameResult?.name || 'tidak dibatalkan');

    const dataResult = await dataTask.then(() => 'selesai').catch(e => 'GAGAL: ' + e.message);
    check('unduhan foto TIDAK ikut dibatalkan', dataResult === 'selesai', dataResult);
    await svc.dispose(); server.close();
  }

  // ── C. Server mati: pesan harus jelas menunjuk koneksi, bukan kamera
  console.log('\n[C] digiCamControl mati');
  {
    const svc = new DigiCamControlService({ baseUrl: 'http://127.0.0.1:59999' });
    svc.liveViewActive = true;
    const res = await svc.fireShutter();
    check('gagal dengan kode CAPTURE_FAILED', res.ok === false && res.code === 'CAPTURE_FAILED');
    check('pesan menyebut digiCamControl tidak berjalan', /tidak berjalan/.test(res.error), res.error?.slice(0, 80));
    check('pesan tidak lagi "fetch failed"', !/fetch failed/.test(res.error));
    await svc.dispose();
  }

  console.log(`\nHasil: ${pass} lulus, ${fail} gagal`);
  process.exit(fail ? 1 : 0);
})();
