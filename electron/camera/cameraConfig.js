/**
 * Persistensi pilihan provider kamera.
 *
 * Memakai file .env mutable yang SAMA dengan yang sudah dipakai aplikasi
 * (userData/.env di produksi, ./.env di development) supaya tidak menambah
 * mekanisme konfigurasi baru. Path-nya diumumkan main.js lewat
 * process.env.MUTABLE_ENV_PATH pada saat loadEnv().
 */
const fs = require('fs');
const path = require('path');

const KEY = 'CAMERA_PROVIDER';
const PROVIDERS = ['webcam', 'digicamcontrol'];
const DEFAULT_PROVIDER = 'webcam';

function getEnvPath() {
  return process.env.MUTABLE_ENV_PATH || path.resolve(process.cwd(), '.env');
}

function parseEnvContent(content) {
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    env[trimmed.substring(0, eqIndex).trim()] = trimmed.substring(eqIndex + 1).trim();
  }
  return env;
}

function buildEnvContent(env) {
  return Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
}

function isValidProvider(name) {
  return PROVIDERS.includes(name);
}

/** @returns {'webcam'|'digicamcontrol'} */
function readProvider() {
  // process.env menang bila sudah di-load main.js, tapi file tetap dibaca ulang
  // supaya perubahan dari sesi sebelumnya langsung terlihat.
  try {
    const envPath = getEnvPath();
    if (fs.existsSync(envPath)) {
      const fromFile = parseEnvContent(fs.readFileSync(envPath, 'utf-8'))[KEY];
      if (isValidProvider(fromFile)) return fromFile;
    }
  } catch (err) {
    console.warn('[CameraConfig] Gagal membaca provider dari .env:', err.message);
  }
  const fromEnv = process.env[KEY];
  return isValidProvider(fromEnv) ? fromEnv : DEFAULT_PROVIDER;
}

/**
 * Tulis pilihan provider tanpa merusak key .env lain.
 * @param {'webcam'|'digicamcontrol'} name
 */
function writeProvider(name) {
  if (!isValidProvider(name)) {
    throw new Error(`Provider tidak dikenal: ${name}`);
  }
  const envPath = getEnvPath();
  let existing = {};
  try {
    if (fs.existsSync(envPath)) {
      existing = parseEnvContent(fs.readFileSync(envPath, 'utf-8'));
    }
  } catch (err) {
    console.warn('[CameraConfig] Gagal membaca .env sebelum menulis:', err.message);
  }

  existing[KEY] = name;

  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, buildEnvContent(existing), 'utf-8');
  process.env[KEY] = name;
  return name;
}

/** Base URL digiCamControl, bisa dioverride lewat .env (DIGICAM_URL). */
function readDigiCamUrl() {
  const raw = (process.env.DIGICAM_URL || '').trim();
  if (raw) return raw.replace(/\/+$/, '');
  try {
    const envPath = getEnvPath();
    if (fs.existsSync(envPath)) {
      const fromFile = parseEnvContent(fs.readFileSync(envPath, 'utf-8')).DIGICAM_URL;
      if (fromFile) return fromFile.trim().replace(/\/+$/, '');
    }
  } catch {
    /* abaikan, pakai default */
  }
  return 'http://127.0.0.1:5513';
}

module.exports = {
  KEY,
  PROVIDERS,
  DEFAULT_PROVIDER,
  isValidProvider,
  readProvider,
  writeProvider,
  readDigiCamUrl,
  getEnvPath,
};
