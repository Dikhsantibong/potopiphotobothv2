/**
 * Uji startLiveView() digiCamControl.
 *
 *   npm run test:liveview
 *
 * Menutup penyebab "Gagal memulai live view: timeout": setiap ULANGI/LANJUT
 * memanggil startLiveView() lagi, dan perintah LiveViewWnd_Show terjebak di
 * belakang antrean polling /liveview.jpg pada web server yang melayani request
 * secara berurutan.
 */
import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { DigiCamControlService } = require('../electron/camera/DigiCamControlService.js');

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

const jpeg = () => {
  const b = Buffer.alloc(4096, 0x40);
  b[0] = 0xff; b[1] = 0xd8;
  b[b.length - 2] = 0xff; b[b.length - 1] = 0xd9;
  return b;
};

/** Web server tiruan digiCamControl: melayani satu request pada satu waktu. */
function makeServer({ showDelay = 0 } = {}) {
  const counts = { show: 0, hide: 0, quality: 0, frame: 0, health: 0 };
  let busy = Promise.resolve();

  const server = http.createServer((req, res) => {
    // Serialkan seperti HttpListener sederhana milik digiCamControl
    busy = busy.then(() => new Promise((done) => {
      const url = req.url;
      const finish = (body, type = 'text/plain') => {
        res.writeHead(200, { 'Content-Type': type });
        res.end(body);
        done();
      };

      if (url.includes('CMD=LiveViewWnd_Show')) {
        counts.show++;
        setTimeout(() => finish('OK'), showDelay);
        return;
      }
      if (url.includes('CMD=LiveViewWnd_Hide')) { counts.hide++; return finish('OK'); }
      if (url.includes('compressionsetting')) { counts.quality++; return finish('OK'); }
      if (url.includes('liveview.jpg')) { counts.frame++; return finish(jpeg(), 'image/jpeg'); }
      counts.health++;
      finish('OK');
    }));
  });
  return { server, counts };
}

const listen = (s) => new Promise(r => s.listen(0, '127.0.0.1', () => r(s.address().port)));

(async () => {
  console.log('Uji startLiveView digiCamControl\n');

  // ── A. Panggilan berulang (ULANGI / LANJUT)
  console.log('[A] startLiveView dipanggil berulang saat live view sudah jalan');
  {
    const { server, counts } = makeServer();
    const port = await listen(server);
    const svc = new DigiCamControlService({ baseUrl: `http://127.0.0.1:${port}`, imageQuality: 'Medium Fine JPEG' });

    const first = await svc.startLiveView();
    check('start pertama berhasil', first.ok === true, first.error || '');
    check('LiveViewWnd_Show dikirim sekali', counts.show === 1, `show=${counts.show}`);
    check('kualitas foto dikirim sekali', counts.quality === 1, `quality=${counts.quality}`);

    const second = await svc.startLiveView();
    const third = await svc.startLiveView();
    check('start ulang tetap ok', second.ok === true && third.ok === true);
    check('start ulang memakai live view yang ada', second.reused === true && third.reused === true);
    check('TIDAK ada LiveViewWnd_Show tambahan', counts.show === 1, `show=${counts.show}`);
    check('TIDAK ada perintah kualitas tambahan', counts.quality === 1, `quality=${counts.quality}`);

    await svc.dispose(); server.close();
  }

  // ── B. Panggilan bersamaan
  console.log('\n[B] startLiveView dipanggil bersamaan');
  {
    const { server, counts } = makeServer({ showDelay: 300 });
    const port = await listen(server);
    const svc = new DigiCamControlService({ baseUrl: `http://127.0.0.1:${port}` });

    const results = await Promise.all([svc.startLiveView(), svc.startLiveView(), svc.startLiveView()]);
    check('semua panggilan berhasil', results.every(r => r.ok));
    check('hanya satu LiveViewWnd_Show terkirim', counts.show === 1, `show=${counts.show}`);

    await svc.dispose(); server.close();
  }

  // ── C. Server lambat menjawab Show (start dingin kamera)
  console.log('\n[C] Server butuh 7 detik menjawab LiveViewWnd_Show');
  {
    const { server, counts } = makeServer({ showDelay: 7000 });
    const port = await listen(server);
    const svc = new DigiCamControlService({ baseUrl: `http://127.0.0.1:${port}` });

    const started = Date.now();
    const res = await svc.startLiveView();
    check('tidak timeout lagi (batas lama 5 detik)', res.ok === true, res.error || `${Date.now() - started}ms`);
    check('perintah benar-benar sampai', counts.show === 1, `show=${counts.show}`);

    await svc.dispose(); server.close();
  }

  // ── D. Live view mati diam-diam → start penuh diulang
  console.log('\n[D] Live view mati diam-diam setelah aktif');
  {
    const { server, counts } = makeServer();
    const port = await listen(server);
    const svc = new DigiCamControlService({ baseUrl: `http://127.0.0.1:${port}` });

    await svc.startLiveView();
    check('show pertama terkirim', counts.show === 1, `show=${counts.show}`);

    server.close();                       // kamera/live view hilang
    const gone = await svc.startLiveView();
    check('dilaporkan gagal, bukan diam-diam ok', gone.ok === false, gone.error?.slice(0, 60));
    check('liveViewActive direset', svc.liveViewActive === false);

    await svc.dispose();
  }

  console.log(`\nHasil: ${pass} lulus, ${fail} gagal`);
  process.exit(fail ? 1 : 0);
})();
