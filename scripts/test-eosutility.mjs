/**
 * Uji provider Canon EOS Utility.
 *
 *   npm run test:eosutility
 *
 * EOS Utility tidak punya API, jadi provider ini bekerja dengan memantau folder
 * simpan Remote Shooting. Yang diuji: kesiapan folder, penangkapan foto baru,
 * penolakan file lama/rusak, dan batasan live view yang dilaporkan jujur.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { EosUtilityService } = require('../electron/camera/EosUtilityService.js');

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const jpeg = (fill) => {
  const b = Buffer.alloc(8192, fill);
  b[0] = 0xff; b[1] = 0xd8; b[b.length - 2] = 0xff; b[b.length - 1] = 0xd9;
  return b;
};

(async () => {
  console.log('Uji provider Canon EOS Utility\n');

  // ── A. Kesiapan
  console.log('[A] Pemeriksaan kesiapan');
  {
    const belum = new EosUtilityService({});
    const h1 = await belum.healthCheck();
    check('folder belum diatur → tidak terhubung', h1.connected === false);
    check('pesannya menuntun ke Settings', /Settings/.test(h1.error || ''), (h1.error || '').slice(0, 50));

    const salah = new EosUtilityService({ watchFolder: path.join(os.tmpdir(), 'folder-tidak-ada-xyz') });
    const h2 = await salah.healthCheck();
    check('folder tidak ada → tidak terhubung', h2.connected === false, h2.error?.slice(0, 40));

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-a-'));
    const siap = new EosUtilityService({ watchFolder: dir });
    const h3 = await siap.healthCheck();
    check('folder valid → terhubung', h3.connected === true);
    check('melaporkan live view tidak didukung', h3.liveViewSupported === false);
    await siap.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── B. Live view memang tidak tersedia
  console.log('\n[B] Live view');
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-b-'));
    const svc = new EosUtilityService({ watchFolder: dir });
    const lv = await svc.startLiveView();
    check('startLiveView tidak dianggap gagal', lv.ok === true);
    check('tapi jujur bilang tidak didukung', lv.liveViewSupported === false);
    const frame = await svc.getFrame();
    check('getFrame menolak dengan NOT_SUPPORTED', frame.code === 'NOT_SUPPORTED');
    await svc.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── C. Menangkap foto baru dari folder
  console.log('\n[C] Menangkap foto dari folder simpan');
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-c-'));
    // Foto lama yang sudah ada sebelum sesi
    fs.writeFileSync(path.join(dir, 'LAMA.JPG'), jpeg(0x11));

    const svc = new EosUtilityService({ watchFolder: dir, captureTimeoutMs: 4000 });
    await svc.armCapture();
    await svc.fireShutter();

    // EOS Utility menulis foto 500 ms setelah shutter
    setTimeout(() => fs.writeFileSync(path.join(dir, 'IMG_9001.JPG'), jpeg(0x55)), 500);

    const got = await svc.collectPhoto({});
    check('foto baru tertangkap', got.ok === true, got.filename || got.error);
    check('bukan foto lama', got.filename === 'IMG_9001.JPG', got.filename);
    check('isinya utuh', got.buffer?.length === 8192);

    // Jepretan kedua tidak boleh mengambil ulang foto pertama
    await svc.armCapture();
    await svc.fireShutter();
    setTimeout(() => fs.writeFileSync(path.join(dir, 'IMG_9002.JPG'), jpeg(0x77)), 400);
    const got2 = await svc.collectPhoto({});
    check('jepretan kedua dapat foto berbeda', got2.ok === true && got2.filename === 'IMG_9002.JPG', got2.filename);

    await svc.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── D. Menolak file yang belum selesai ditulis
  console.log('\n[D] File JPEG belum lengkap');
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-d-'));
    const svc = new EosUtilityService({ watchFolder: dir, captureTimeoutMs: 1500 });
    await svc.fireShutter();
    const rusak = Buffer.alloc(8192, 0x22);
    rusak[0] = 0xff; rusak[1] = 0xd8;   // ada SOI, tanpa EOI
    fs.writeFileSync(path.join(dir, 'SETENGAH.JPG'), rusak);

    const got = await svc.collectPhoto({});
    check('file setengah jadi ditolak', got.ok === false && got.code === 'CAPTURE_TIMEOUT');
    check('pesan menuntun ke folder/shutter', /folder|shutter/i.test(got.error || ''));
    await svc.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── E. Salin ke folder sesi photobooth
  console.log('\n[E] Salinan ke folder sesi');
  {
    const watch = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-e-watch-'));
    const sesi = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-e-sesi-'));
    const svc = new EosUtilityService({ watchFolder: watch, captureTimeoutMs: 3000 });
    await svc.fireShutter();
    setTimeout(() => fs.writeFileSync(path.join(watch, 'IMG_7000.JPG'), jpeg(0x33)), 300);

    const got = await svc.collectPhoto({ sessionDir: sesi });
    check('foto tertangkap', got.ok === true);
    check('disalin ke folder sesi', fs.existsSync(path.join(sesi, 'IMG_7000.JPG')));
    check('file asli EOS Utility tetap ada', fs.existsSync(path.join(watch, 'IMG_7000.JPG')));
    await svc.dispose();
    fs.rmSync(watch, { recursive: true, force: true });
    fs.rmSync(sesi, { recursive: true, force: true });
  }

  console.log(`\nHasil: ${pass} lulus, ${fail} gagal`);
  process.exit(fail ? 1 : 0);
})();
