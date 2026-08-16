/**
 * Uji CameraProviderManager tanpa Electron dan tanpa digiCamControl.
 *
 *   npm run test:camera-config
 *
 * Mencakup skenario 6–9 pada level logika:
 *   6/7. Toggle provider bolak-balik + provider lama dihentikan bersih
 *   8.   Toggle ke digiCamControl saat Web Server mati → error + rollback
 *   9.   Toggle saat sesi capture berjalan → ditolak dengan pesan jelas
 *
 * Juga menguji persistensi pilihan di .env tanpa merusak key lain.
 */
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

// .env sementara: harus di-set SEBELUM modul config dimuat pertama kali.
const workDir = mkdtempSync(path.join(tmpdir(), 'roambooth-camtest-'));
const envPath = path.join(workDir, '.env');
writeFileSync(envPath, 'TOKEN=abc123\nBASE_URL=https://example.test\n', 'utf-8');
process.env.MUTABLE_ENV_PATH = envPath;
// Port yang dijamin tidak melayani apa pun, supaya health check digiCamControl gagal.
process.env.DIGICAM_URL = 'http://127.0.0.1:59999';

const config = require('../electron/camera/cameraConfig.js');
const { CameraProviderManager } = require('../electron/camera/CameraProviderManager.js');

let passed = 0;
let failed = 0;
const check = (name, condition, detail = '') => {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

/** Bridge palsu yang mencatat perintah yang dikirim ke renderer. */
function makeBridge() {
  const calls = [];
  return {
    calls,
    request(action) {
      calls.push(action);
      if (action === 'status') {
        return Promise.resolve({ ok: true, data: { videoInputs: 1, streaming: true } });
      }
      return Promise.resolve({ ok: true, data: {} });
    },
  };
}

(async () => {
  console.log(`CameraProviderManager test — env: ${envPath}`);

  // ── Persistensi config ──────────────────────────────────────
  console.log('\n[A] Persistensi pilihan provider di .env');
  check('default provider = webcam', config.readProvider() === 'webcam', config.readProvider());

  config.writeProvider('digicamcontrol');
  check('readProvider setelah write', config.readProvider() === 'digicamcontrol');

  const written = readFileSync(envPath, 'utf-8');
  check('key .env lain tetap utuh', written.includes('TOKEN=abc123') && written.includes('BASE_URL=https://example.test'));

  config.writeProvider('webcam');
  check('kembali ke webcam', config.readProvider() === 'webcam');

  let threw = false;
  try {
    config.writeProvider('kamera-ajaib');
  } catch {
    threw = true;
  }
  check('provider tak dikenal ditolak', threw);

  // ── Init ────────────────────────────────────────────────────
  console.log('\n[B] Init manager');
  const bridge = makeBridge();
  const events = [];

  // Pengganti jendela Electron: mencatat kapan aplikasi dikunci di depan dan
  // kapan posisinya direbut kembali dari jendela digiCamControl.
  const guard = {
    pinned: null,
    reclaims: 0,
    disposed: false,
    setPinned(v) { this.pinned = v; },
    reclaim() { this.reclaims++; },
    dispose() { this.disposed = true; },
  };

  const manager = new CameraProviderManager({
    bridge,
    sessionRoot: path.join(workDir, 'sessions'),
    windowGuard: guard,
    emit: (channel, payload) => events.push({ channel, payload }),
  });
  await manager.init();
  check('provider aktif = webcam', manager.getProvider() === 'webcam');
  const health = await manager.healthCheck();
  check('webcam connected', health.connected === true, JSON.stringify(health));

  // ── Skenario 9: tolak switch saat sesi berjalan ─────────────
  console.log('\n[9] Ganti provider saat sesi capture berjalan');
  await manager.setSessionActive(true);
  const duringSession = await manager.setProvider('digicamcontrol');
  check('ditolak dengan code SESSION_ACTIVE', duringSession.code === 'SESSION_ACTIVE');
  check(
    'pesan jelas ke user',
    duringSession.error === 'Selesaikan atau batalkan sesi saat ini sebelum mengganti sumber kamera',
    duringSession.error
  );
  check('provider tidak berubah', manager.getProvider() === 'webcam');
  await manager.setSessionActive(false);

  // ── Skenario 8: digiCamControl mati → rollback ──────────────
  console.log('\n[8] Toggle ke digiCamControl saat Web Server tidak berjalan');
  bridge.calls.length = 0;
  const switchFail = await manager.setProvider('digicamcontrol');
  check('gagal, tidak crash', switchFail.ok === false, switchFail.code);
  check('rollback ke webcam', manager.getProvider() === 'webcam', `rolledBackTo=${switchFail.rolledBackTo}`);
  check('kamera tidak mati total', switchFail.connected === true);
  check('pesan error informatif', /tidak tersedia/i.test(switchFail.error || ''), switchFail.error);
  check('provider lama dihentikan lebih dulu', bridge.calls.includes('stop'), bridge.calls.join(','));
  check('config .env tidak ikut berubah', config.readProvider() === 'webcam');
  check('event providerChanged dikirim', events.some((e) => e.channel === 'camera:providerChanged'));

  // ── Skenario 6/7: switch sukses bolak-balik ────────────────
  console.log('\n[6/7] Toggle bolak-balik dengan provider yang sehat');
  // Paksa digiCamControl "sehat" dengan menstub health check-nya.
  const realCreate = manager._create.bind(manager);
  manager._create = (name) => {
    const provider = realCreate(name);
    if (name === 'digicamcontrol') {
      provider.healthCheck = async () => ({ connected: true, provider: 'digicamcontrol', baseUrl: 'stub' });
      provider.getStatus = async () => ({ connected: true, provider: 'digicamcontrol' });
      provider.stopLiveView = async () => {
        provider._stopped = true;
        return { ok: true };
      };
    }
    return provider;
  };

  bridge.calls.length = 0;
  const toDcc = await manager.setProvider('digicamcontrol');
  check('switch ke digicamcontrol sukses', toDcc.ok === true, toDcc.error || '');
  check('provider aktif = digicamcontrol', manager.getProvider() === 'digicamcontrol');
  check('MediaStream webcam dihentikan', bridge.calls.includes('stop'), bridge.calls.join(','));
  check('pilihan tersimpan di .env', config.readProvider() === 'digicamcontrol');

  const dccProvider = manager.provider;
  const backToWebcam = await manager.setProvider('webcam');
  check('switch balik ke webcam sukses', backToWebcam.ok === true, backToWebcam.error || '');
  check('provider aktif = webcam', manager.getProvider() === 'webcam');
  check('provider digiCamControl di-dispose', dccProvider.disposed === true);
  check('live view digiCamControl dimatikan', dccProvider.liveViewActive === false);
  check('tidak ada koneksi HTTP menggantung', dccProvider.pending.size === 0);
  check('pilihan tersimpan kembali di .env', config.readProvider() === 'webcam');

  const unchanged = await manager.setProvider('webcam');
  check('pilih provider yang sama = no-op', unchanged.ok === true && unchanged.unchanged === true);

  // ── Jendela digiCamControl tidak boleh menutupi photobooth ──
  console.log('\n[C] Jendela aplikasi tetap di depan saat sesi digiCamControl');

  guard.pinned = null;
  await manager.setSessionActive(true);
  check('provider webcam tidak mengunci jendela', guard.pinned === false, `pinned=${guard.pinned}`);
  await manager.setSessionActive(false);

  await manager.setProvider('digicamcontrol');
  guard.pinned = null;
  guard.reclaims = 0;

  await manager.setSessionActive(true);
  check('sesi digiCamControl mengunci jendela di depan', guard.pinned === true, `pinned=${guard.pinned}`);

  // Perintah yang membuka jendela Live View harus merebut posisi depan.
  const dcc = manager.provider;
  await dcc._cmdRaisingWindow('LiveViewWnd_Show', { timeout: 500 }).catch(() => { });
  check('posisi depan direbut setelah LiveViewWnd_Show', guard.reclaims >= 1, `reclaim=${guard.reclaims}`);

  // Server mati pada test ini, jadi perintah gagal — reclaim tetap harus jalan.
  const before = guard.reclaims;
  await dcc._cmdRaisingWindow('CaptureNoAf', { timeout: 500 }).catch(() => { });
  check('posisi depan direbut walau perintah gagal', guard.reclaims > before, `reclaim=${guard.reclaims}`);

  await manager.setSessionActive(false);
  check('kunci dilepas setelah sesi selesai', guard.pinned === false, `pinned=${guard.pinned}`);

  await manager.setProvider('webcam');
  await manager.shutdown();
  check('kunci dilepas dan guard dibersihkan saat shutdown', guard.pinned === false && guard.disposed === true);

  console.log(`\nHasil: ${passed} lulus, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
})();
