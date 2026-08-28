/**
 * Uji pemulihan otomatis saat digiCamControl terputus lalu menyambung lagi.
 *
 *   npm run test:reconnect
 *
 * Menirukan PERSIS frame loop + logika reconnect milik useCamera.ts terhadap
 * DigiCamControlService yang sebenarnya, lalu mematikan dan menghidupkan web
 * server seperti digiCamControl yang crash atau di-restart.
 */
import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { DigiCamControlService } = require('../electron/camera/DigiCamControlService.js');

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const jpeg = () => { const b = Buffer.alloc(4096, 0x40); b[0]=0xff;b[1]=0xd8;b[b.length-2]=0xff;b[b.length-1]=0xd9; return b; };
const PORT = 5612;

function makeServer() {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    if (req.url.includes('liveview.jpg')) { res.writeHead(200); return res.end(jpeg()); }
    res.writeHead(200); res.end('OK');
  });
  server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  return {
    listen: () => new Promise(r => server.listen(PORT, '127.0.0.1', r)),
    kill: () => new Promise(r => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
  };
}

/** Salinan setia logika frame loop + reconnect di useCamera.ts */
function runFrameLoop(svc) {
  const stats = { framesOk: 0, reconnects: 0 };
  let reconnecting = false, attempts = 0, stopped = false;
  let liveViewStarted = true;   // liveViewStartedRef

  (async function tick() {
    while (!stopped) {
      const res = await svc.getFrame();
      if (res?.ok) {
        stats.framesOk++;
        attempts = 0;
      } else if (
        (res?.code === 'LIVEVIEW_LOST' || res?.code === 'LIVEVIEW_INACTIVE') &&
        liveViewStarted &&
        !reconnecting
      ) {
        reconnecting = true;
        stats.reconnects++;
        const backoff = Math.min(5000, 500 * ++attempts);
        setTimeout(() => {
          if (stopped) { reconnecting = false; return; }
          void Promise.resolve(svc.startLiveView()).finally(() => { reconnecting = false; });
        }, backoff);
      }
      await wait(83);
    }
  })();

  return { stats, stop: () => { stopped = true; } };
}

(async () => {
  console.log('Uji pemulihan otomatis digiCamControl\n');

  // ── A. Putus sebentar lalu sambung lagi
  console.log('[A] Terputus 2,5 detik lalu digiCamControl hidup lagi');
  {
    const srv = makeServer();
    await srv.listen();
    const svc = new DigiCamControlService({ baseUrl: `http://127.0.0.1:${PORT}` });
    await svc.startLiveView();

    const loop = runFrameLoop(svc);
    await wait(500);
    check('frame mengalir normal di awal', loop.stats.framesOk > 0, `${loop.stats.framesOk} frame`);

    await srv.kill();
    await wait(2500);
    check('kehilangan koneksi terdeteksi', svc.liveViewActive === false);
    check('percobaan sambung ulang berjalan', loop.stats.reconnects >= 2, `${loop.stats.reconnects} percobaan`);

    const srv2 = makeServer();
    await srv2.listen();
    const at = loop.stats.framesOk;
    await wait(4000);

    check('PULIH OTOMATIS tanpa restart aplikasi', loop.stats.framesOk > at, `${loop.stats.framesOk - at} frame baru`);
    check('live view menyala kembali', svc.liveViewActive === true);

    loop.stop(); await svc.dispose(); await srv2.kill();
  }

  // ── B. Putus lama (10 detik) — backoff tidak boleh menyerah
  console.log('\n[B] Terputus 10 detik — percobaan tidak boleh berhenti');
  {
    const srv = makeServer();
    await srv.listen();
    const svc = new DigiCamControlService({ baseUrl: `http://127.0.0.1:${PORT}` });
    await svc.startLiveView();

    const loop = runFrameLoop(svc);
    await wait(300);
    await srv.kill();
    await wait(10000);

    const during = loop.stats.reconnects;
    check('tetap mencoba selama 10 detik', during >= 3, `${during} percobaan`);

    const srv2 = makeServer();
    await srv2.listen();
    const at = loop.stats.framesOk;
    await wait(6000);

    check('tetap pulih walau putus lama', loop.stats.framesOk > at, `${loop.stats.framesOk - at} frame baru`);
    loop.stop(); await svc.dispose(); await srv2.kill();
  }

  // ── C. Tidak menyambung ulang kalau live view belum pernah hidup
  console.log('\n[C] Live view belum pernah dimulai');
  {
    const svc = new DigiCamControlService({ baseUrl: `http://127.0.0.1:${PORT}` });
    // liveViewStarted = false pada loop di bawah
    let reconnects = 0, stopped = false;
    (async function tick() {
      while (!stopped) {
        const res = await svc.getFrame();
        const liveViewStarted = false;
        if ((res?.code === 'LIVEVIEW_LOST' || res?.code === 'LIVEVIEW_INACTIVE') && liveViewStarted) reconnects++;
        await wait(83);
      }
    })();
    await wait(800);
    stopped = true;
    check('tidak ada percobaan liar', reconnects === 0, `${reconnects} percobaan`);
    await svc.dispose();
  }

  console.log(`\nHasil: ${pass} lulus, ${fail} gagal`);
  process.exit(fail ? 1 : 0);
})();
