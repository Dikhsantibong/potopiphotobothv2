/**
 * Uji pengambilan file foto saat live view tetap memoll.
 *
 *   npm run test:collect
 *
 * Mereproduksi penyebab "Kamera tidak merespon, coba lagi": collectPhoto memoll
 * lastcaptured setiap 250ms sementara frame loop memoll /liveview.jpg 12 fps.
 * Web server digiCamControl melayani request satu per satu, jadi polling frame
 * membuat lastcaptured kelaparan sampai batas 12 detik terlampaui.
 */
import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { DigiCamControlService } = require('../electron/camera/DigiCamControlService.js');

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

const jpeg = () => {
  const b = Buffer.alloc(4096, 0x40);
  b[0] = 0xff; b[1] = 0xd8; b[b.length - 2] = 0xff; b[b.length - 1] = 0xd9;
  return b;
};

/**
 * Web server tiruan digiCamControl: SATU request pada satu waktu, tiap request
 * makan waktu `latency` — persis alasan antrean jadi penting.
 */
function makeServer({ latency = 80, writeDelay = 1000 } = {}) {
  let lastCaptured = 'IMG_0001.JPG';
  let seq = 1;
  const counts = { frame: 0, lastcaptured: 0, image: 0 };
  let busy = Promise.resolve();

  const server = http.createServer((req, res) => {
    busy = busy.then(() => new Promise((done) => setTimeout(() => {
      const url = req.url;
      const finish = (body, type = 'text/plain') => { res.writeHead(200, { 'Content-Type': type }); res.end(body); done(); };

      if (url.includes('liveview.jpg')) { counts.frame++; return finish(jpeg(), 'image/jpeg'); }
      if (url.includes('lastcaptured')) { counts.lastcaptured++; return finish(lastCaptured); }
      if (url.includes('/image/')) { counts.image++; return finish(jpeg(), 'image/jpeg'); }
      if (url.includes('CMD=CaptureNoAf') || url.includes('CMD=Capture')) {
        // Kamera butuh waktu menulis + mentransfer file ke PC
        setTimeout(() => { seq++; lastCaptured = `IMG_${String(seq).padStart(4, '0')}.JPG`; }, writeDelay);
        return finish('OK');
      }
      finish('OK');
    }, latency)));
  });
  return { server, counts, current: () => lastCaptured };
}

const listen = (s) => new Promise(r => s.listen(0, '127.0.0.1', () => r(s.address().port)));

/** Meniru frame loop renderer: 12 fps, terus jalan seperti di halaman kamera. */
function startFrameLoop(svc) {
  let stopped = false;
  let served = 0, skipped = 0;
  (async function tick() {
    while (!stopped) {
      const res = await svc.getFrame();
      if (res.ok) served++; else if (res.code === 'BUSY') skipped++;
      await new Promise(r => setTimeout(r, 83));
    }
  })();
  return { stop: () => { stopped = true; }, stats: () => ({ served, skipped }) };
}

(async () => {
  console.log('Uji collectPhoto saat live view memoll bersamaan\n');

  console.log('[A] Siklus jepret penuh dengan frame loop 12 fps aktif');
  {
    const { server, counts } = makeServer();
    const port = await listen(server);
    const svc = new DigiCamControlService({ baseUrl: `http://127.0.0.1:${port}` });
    const os = await import('node:os');
    const sessionDir = (await import('node:fs')).mkdtempSync((await import('node:path')).join(os.tmpdir(), 'sesi-'));

    await svc.startLiveView();
    const loop = startFrameLoop(svc);
    await new Promise(r => setTimeout(r, 400)); // biarkan preview jalan dulu

    const started = Date.now();
    const armed = await svc.armCapture();
    check('armCapture berhasil', armed.ok === true, `baseline=${armed.baseline}`);
    check('baseline bukan null', armed.baseline !== null);

    const fired = await svc.fireShutter();
    check('shutter berhasil', fired.ok === true, fired.error || '');

    const got = await svc.collectPhoto({ sessionDir });
    const elapsed = Date.now() - started;
    check('foto berhasil diambil dari kamera', got.ok === true, got.error || `${elapsed}ms`);
    check('selesai jauh di bawah batas 12 detik', elapsed < 6000, `${elapsed}ms`);
    check('file diunduh dari /image/, bukan fallback preview', counts.image > 0, `image=${counts.image}`);

    const stats = loop.stats();
    check('frame di-skip selama operasi kritis', stats.skipped > 0, `dilayani=${stats.served}, di-skip=${stats.skipped}`);
    loop.stop();
    await svc.dispose(); server.close();
  }

  console.log('\n[B] Baseline tidak jatuh ke null saat server gagal menjawab');
  {
    const { server } = makeServer();
    const port = await listen(server);
    const svc = new DigiCamControlService({ baseUrl: `http://127.0.0.1:${port}` });
    svc.liveViewActive = true;
    svc.lastCollectedFilename = 'IMG_0009.JPG';

    // Paksa getLastCaptured gagal, seperti saat request timeout
    svc.getLastCaptured = async () => { throw new Error('timeout'); };

    const armed = await svc.armCapture();
    check('baseline memakai file terakhir yang diunduh', svc.armedBaseline === 'IMG_0009.JPG', `baseline=${svc.armedBaseline}`);
    check('tidak jatuh ke null', armed.baseline !== null);

    await svc.dispose(); server.close();
  }

  console.log('\n[C] Jepretan kedua memakai baseline dari jepretan pertama');
  {
    const { server } = makeServer();
    const port = await listen(server);
    const svc = new DigiCamControlService({ baseUrl: `http://127.0.0.1:${port}` });
    const os = await import('node:os');
    const sessionDir = (await import('node:fs')).mkdtempSync((await import('node:path')).join(os.tmpdir(), 'sesi-'));

    await svc.startLiveView();
    await svc.armCapture();
    await svc.fireShutter();
    const first = await svc.collectPhoto({ sessionDir });
    check('jepretan pertama berhasil', first.ok === true, first.error || '');
    check('nama file dicatat untuk baseline berikutnya', !!svc.lastCollectedFilename, svc.lastCollectedFilename || '-');

    await svc.armCapture();
    await svc.fireShutter();
    const second = await svc.collectPhoto({ sessionDir });
    check('jepretan kedua berhasil', second.ok === true, second.error || '');
    check('foto kedua berbeda dari yang pertama', second.filename !== first.filename, `${first.filename} -> ${second.filename}`);

    await svc.dispose(); server.close();
  }

  console.log(`\nHasil: ${pass} lulus, ${fail} gagal`);
  process.exit(fail ? 1 : 0);
})();
