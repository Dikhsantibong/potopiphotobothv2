/**
 * Uji digiCamControl Web Server secara terpisah dari aplikasi.
 *
 *   npm run test:digicam
 *   npm run test:digicam -- --url http://127.0.0.1:5513 --skip-capture
 *
 * Mencakup skenario 1–4:
 *   1. Web server health check
 *   2. Camera detected
 *   3. Start Live View + terima frame
 *   4. Capture → deteksi lastcaptured → download image
 *
 * Prasyarat: digiCamControl berjalan, Settings → Webserver → Use web server
 * aktif, lalu digiCamControl di-restart. Canon EOS terhubung dan EOS Webcam
 * Utility TIDAK berjalan (rebutan device USB).
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE_URL = (getArg('url', 'http://127.0.0.1:5513')).replace(/\/+$/, '');
const SKIP_CAPTURE = args.includes('--skip-capture');
const OUT_DIR = getArg('out', path.join(os.tmpdir(), 'roambooth-digicam-test'));

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;

function ok(name, detail = '') {
  passed++;
  console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, detail = '') {
  failed++;
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function req(suffix, { timeout = 5000, raw = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(BASE_URL + suffix, { signal: controller.signal });
    if (raw) return { status: res.status, ok: res.ok, buffer: Buffer.from(await res.arrayBuffer()) };
    return { status: res.status, ok: res.ok, text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

function isCompleteJpeg(buffer) {
  if (!buffer || buffer.length < 1024) return false;
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return false;
  return buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
}

// ── 1. Health check ───────────────────────────────────────────
async function testHealthCheck() {
  console.log('\n[1] Web server health check');
  try {
    const res = await req('/', { timeout: 2500 });
    if (res.status < 500) {
      ok('GET /', `HTTP ${res.status}`);
      return true;
    }
    fail('GET /', `HTTP ${res.status}`);
    return false;
  } catch (err) {
    fail('GET /', `${err.name === 'AbortError' ? 'timeout' : err.message}. DigiCamControl Web Server tidak tersedia.`);
    return false;
  }
}

// ── 2. Camera detected ────────────────────────────────────────
async function testCameraDetected() {
  console.log('\n[2] Camera detected');
  try {
    const res = await req('/?slc=list&param1=cameras&param2=', { timeout: 3000 });
    const list = (res.text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (list.length > 0) {
      ok('slc=list cameras', list.join(', '));
      return true;
    }
    fail('slc=list cameras', 'daftar kamera kosong — pastikan Canon EOS menyala dan tidak dipakai EOS Webcam Utility');
    return false;
  } catch (err) {
    fail('slc=list cameras', err.message);
    return false;
  }
}

// ── 3. Live view ──────────────────────────────────────────────
async function testLiveView() {
  console.log('\n[3] Start Live View + terima frame');
  try {
    await req('/?CMD=LiveViewWnd_Show', { timeout: 5000 });
    ok('CMD=LiveViewWnd_Show', 'perintah terkirim');
  } catch (err) {
    fail('CMD=LiveViewWnd_Show', err.message);
    return false;
  }

  const deadline = Date.now() + 8000;
  let frame = null;
  while (Date.now() < deadline) {
    try {
      const res = await req(`/liveview.jpg?t=${Date.now()}`, { timeout: 2500, raw: true });
      if (res.ok && res.buffer.length > 1024) {
        frame = res.buffer;
        break;
      }
    } catch {
      /* retry */
    }
    await delay(250);
  }

  if (!frame) {
    fail('GET /liveview.jpg', 'tidak ada frame dalam 8 detik');
    return false;
  }
  ok('GET /liveview.jpg', `${(frame.length / 1024).toFixed(1)} KB`);

  // Ukur laju frame nyata selama 2 detik pada target 12 fps.
  const started = Date.now();
  let frames = 0;
  while (Date.now() - started < 2000) {
    try {
      const res = await req(`/liveview.jpg?t=${Date.now()}`, { timeout: 2000, raw: true });
      if (res.ok && res.buffer.length > 1024) frames++;
    } catch {
      /* abaikan */
    }
    await delay(83);
  }
  ok('Laju frame', `${(frames / 2).toFixed(1)} fps efektif`);

  try {
    await req('/?CMD=LiveViewWnd_Hide', { timeout: 3000 });
    ok('CMD=LiveViewWnd_Hide', 'live view dihentikan');
  } catch (err) {
    fail('CMD=LiveViewWnd_Hide', err.message);
  }
  return true;
}

// ── 4. Capture → lastcaptured → download ──────────────────────
async function testCapture() {
  console.log('\n[4] Capture → lastcaptured → download image');

  await mkdir(OUT_DIR, { recursive: true });
  try {
    const res = await req(`/?slc=set&param1=session.folder&param2=${encodeURIComponent(OUT_DIR)}`, { timeout: 4000 });
    ok('set session.folder', `${OUT_DIR} (HTTP ${res.status})`);
  } catch (err) {
    fail('set session.folder', err.message);
  }

  await req('/?CMD=LiveViewWnd_Show', { timeout: 5000 }).catch(() => { });
  await delay(1000);

  let before = null;
  try {
    const res = await req('/?slc=get&param1=lastcaptured&param2=', { timeout: 3000 });
    const raw = (res.text || '').trim();
    before = raw && raw !== '-' ? raw : null;
    ok('baseline lastcaptured', before || '(kosong)');
  } catch (err) {
    fail('baseline lastcaptured', err.message);
  }

  try {
    await req('/?CMD=Capture', { timeout: 8000 });
    ok('CMD=Capture', 'shutter dipicu');
  } catch (err) {
    fail('CMD=Capture', err.message);
    return false;
  }

  const deadline = Date.now() + 10000;
  let filename = null;
  while (Date.now() < deadline) {
    await delay(300);
    try {
      const res = await req('/?slc=get&param1=lastcaptured&param2=', { timeout: 3000 });
      const raw = (res.text || '').trim();
      if (raw && raw !== '-' && raw !== before) {
        filename = raw;
        break;
      }
    } catch {
      /* retry sampai timeout */
    }
  }

  if (!filename) {
    fail('poll lastcaptured', 'timeout 10 detik — kamera tidak merespon');
    await req('/?CMD=LiveViewWnd_Hide', { timeout: 3000 }).catch(() => { });
    return false;
  }
  ok('poll lastcaptured', filename);

  const basename = path.basename(filename);
  const downloadDeadline = Date.now() + 8000;
  let buffer = null;
  let source = null;

  while (Date.now() < downloadDeadline && !buffer) {
    for (const suffix of [`/image/${encodeURIComponent(basename)}`, `/preview.jpg?t=${Date.now()}`]) {
      try {
        const res = await req(suffix, { timeout: 8000, raw: true });
        if (res.ok && isCompleteJpeg(res.buffer)) {
          buffer = res.buffer;
          source = suffix;
          break;
        }
      } catch {
        /* coba kandidat berikutnya */
      }
    }
    if (!buffer) await delay(250);
  }

  if (!buffer) {
    fail('download image', 'JPG tidak lengkap / tidak dapat diunduh dalam 8 detik');
    await req('/?CMD=LiveViewWnd_Hide', { timeout: 3000 }).catch(() => { });
    return false;
  }

  const outPath = path.join(OUT_DIR, basename);
  await writeFile(outPath, buffer);
  ok('download image', `${(buffer.length / 1024).toFixed(1)} KB via ${source.split('?')[0]} → ${outPath}`);

  await req('/?CMD=LiveViewWnd_Hide', { timeout: 3000 }).catch(() => { });
  return true;
}

// ── Runner ────────────────────────────────────────────────────
(async () => {
  console.log(`digiCamControl test — ${BASE_URL}`);

  const healthy = await testHealthCheck();
  if (!healthy) {
    console.log('\nWeb server tidak menjawab. Jalankan digiCamControl, aktifkan');
    console.log('Settings → Webserver → Use web server, lalu restart digiCamControl.');
    console.log(`\nHasil: ${passed} lulus, ${failed} gagal`);
    process.exit(1);
  }

  await testCameraDetected();
  await testLiveView();
  if (SKIP_CAPTURE) {
    console.log('\n[4] Capture — dilewati (--skip-capture)');
  } else {
    await testCapture();
  }

  console.log(`\nHasil: ${passed} lulus, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
})();
