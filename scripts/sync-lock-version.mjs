/**
 * Samakan identitas package-lock.json dengan package.json.
 *
 *   npm run version:sync           → perbaiki dan tulis ulang lock
 *   npm run version:sync -- --check → hanya laporkan, jangan menulis (exit 0)
 *
 * Hanya menyentuh field name/version di root lock dan di packages[""].
 * Pohon dependensi tidak disentuh sama sekali, jadi aman dijalankan kapan pun —
 * termasuk di CI sebelum `npm ci`.
 *
 * Kenapa perlu: menaikkan "version" di package.json secara manual meninggalkan
 * package-lock.json di versi lama. Itu tidak menggagalkan `npm ci`, tapi bikin
 * bingung saat menelusuri rilis mana yang sebenarnya dibangun.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const checkOnly = process.argv.includes('--check');

const root = process.cwd();
const pkgPath = path.join(root, 'package.json');
const lockPath = path.join(root, 'package-lock.json');

const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));

const before = {
  name: lock.name,
  version: lock.version,
  rootName: lock.packages?.['']?.name,
  rootVersion: lock.packages?.['']?.version,
};

const inSync =
  before.name === pkg.name &&
  before.version === pkg.version &&
  before.rootName === pkg.name &&
  before.rootVersion === pkg.version;

if (inSync) {
  console.log(`package-lock.json sudah sinkron: ${pkg.name}@${pkg.version}`);
  process.exit(0);
}

console.log(`package.json      : ${pkg.name}@${pkg.version}`);
console.log(`package-lock.json : ${before.name}@${before.version} (packages[""] ${before.rootName}@${before.rootVersion})`);

if (checkOnly) {
  console.log('Tidak sinkron. Jalankan: npm run version:sync');
  process.exit(0);
}

lock.name = pkg.name;
lock.version = pkg.version;
if (lock.packages?.['']) {
  lock.packages[''].name = pkg.name;
  lock.packages[''].version = pkg.version;
}

writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
console.log(`package-lock.json disinkronkan ke ${pkg.name}@${pkg.version}`);
