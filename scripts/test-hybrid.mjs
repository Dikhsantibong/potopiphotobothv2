/**
 * Uji Hybrid DSLR Mode.
 *
 *   npm run test:hybrid
 *
 * Preview diambil dari HDMI capture card (muncul sebagai webcam), sementara
 * foto tetap dari provider DSLR. Yang diuji: live view DSLR benar-benar tidak
 * dinyalakan, shutter tetap bekerja, dan default lama tidak berubah.
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-'));
process.env.MUTABLE_ENV_PATH = path.join(workDir, '.env');
fs.writeFileSync(process.env.MUTABLE_ENV_PATH, 'TOKEN=abc\n', 'utf-8');

const require = createRequire(import.meta.url);
const config = require('../electron/camera/cameraConfig.js');
const { DigiCamControlService } = require('../electron/camera/DigiCamControlService.js');

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

const jpeg = () => { const b = Buffer.alloc(4096, 0x40); b[0]=0xff;b[1]=0xd8;b[b.length-2]=0xff;b[b.length-1]=0xd9; return b; };
let PORT = 5620;

function makeServer() {
  PORT++;
  const myPort = PORT;
  const hits = [];
  let last = 'IMG_0001.JPG', seq = 1;
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    if (req.url.includes('liveview.jpg')) { res.writeHead(200); return res.end(jpeg()); }
    if (req.url.includes('lastcaptured')) { res.writeHead(200); return res.end(last); }
    if (req.url.includes('/image/')) { res.writeHead(200); return res.end(jpeg()); }
    if (req.url.includes('CMD=Capture')) {
      setTimeout(() => { seq++; last = `IMG_000${seq}.JPG`; }, 200);
      res.writeHead(200); return res.end('OK');
    }
    res.writeHead(200); res.end('OK');
  });
  return {
    hits,
    port: myPort,
    listen: () => new Promise(r => server.listen(myPort, '127.0.0.1', r)),
    close: () => new Promise(r => server.close(() => r())),
  };
}

(async () => {
  console.log('Uji Hybrid DSLR Mode\n');

  console.log('[A] Default tidak berubah');
  {
    check('sumber preview bawaan = provider', config.readPreviewSource() === 'provider');
    const svc = new DigiCamControlService({ baseUrl: `http://127.0.0.1:${PORT}` });
    check('live view tetap diwajibkan (perilaku lama)', svc.liveViewForCapture === true);
    await svc.dispose();
  }

  console.log('\n[B] Hybrid: live view DSLR TIDAK dinyalakan');
  {
    const srv = makeServer();
    await srv.listen();
    const svc = new DigiCamControlService({
      baseUrl: `http://127.0.0.1:${srv.port}`,
      liveViewForCapture: false,
    });

    await svc.armCapture();
    const showCmds = srv.hits.filter((u) => u.includes('LiveViewWnd_Show'));
    check('tidak ada perintah LiveViewWnd_Show', showCmds.length === 0, `${showCmds.length} perintah`);
    check('tidak ada polling frame live view', srv.hits.filter((u) => u.includes('liveview.jpg')).length === 0);

    const fired = await svc.fireShutter();
    check('shutter tetap bekerja tanpa live view', fired.ok === true, fired.error || '');

    const got = await svc.collectPhoto({ sessionDir: workDir });
    check('foto tetap terambil', got.ok === true, got.error || got.filename);

    const showAfter = srv.hits.filter((u) => u.includes('LiveViewWnd_Show'));
    check('live view tidak dinyalakan ulang setelah capture', showAfter.length === 0, `${showAfter.length} perintah`);

    await svc.dispose(); await srv.close();
  }

  console.log('\n[C] Mode bawaan tetap memakai live view');
  {
    const srv = makeServer();
    await srv.listen();
    const svc = new DigiCamControlService({ baseUrl: `http://127.0.0.1:${srv.port}` });

    await svc.armCapture();
    check('live view dinyalakan seperti biasa', srv.hits.some((u) => u.includes('LiveViewWnd_Show')),
      srv.hits.join(' | ').slice(0, 70));
    await svc.dispose(); await srv.close();
  }

  console.log('\n[D] Persistensi pilihan');
  {
    config.writePreviewSource('webcam');
    check('tersimpan sebagai webcam', config.readPreviewSource() === 'webcam');
    config.writePreviewSource('provider');
    check('kembali ke provider', config.readPreviewSource() === 'provider');
    config.writePreviewSource('ngawur');
    check('nilai tak dikenal jatuh ke default', config.readPreviewSource() === 'provider');
    const env = fs.readFileSync(process.env.MUTABLE_ENV_PATH, 'utf-8');
    check('key .env lain tetap utuh', env.includes('TOKEN=abc'));
  }

  fs.rmSync(workDir, { recursive: true, force: true });
  console.log(`\nHasil: ${pass} lulus, ${fail} gagal`);
  process.exit(fail ? 1 : 0);
})();
