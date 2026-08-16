/**
 * Uji bahwa metadata EXIF kamera bertahan saat foto diperkecil.
 *
 *   npm run test:exif
 *
 * Membuat JPEG ber-EXIF sintetis (Make/Model Canon), memotongnya lewat
 * extractExifSegment/insertExifSegment yang dipakai lapisan IPC, lalu memeriksa
 * segmen Exif masih ada dan isinya utuh di file hasil.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

// ── Bangun JPEG minimal dengan APP0 (JFIF) + APP1 (Exif) ────
function buildExifPayload() {
  // TIFF little-endian, 2 tag: Make (0x010F) dan Model (0x0110)
  const make = Buffer.from('Canon\0');
  const model = Buffer.from('Canon EOS 200D\0');

  const header = Buffer.alloc(8);
  header.write('II', 0, 'latin1');
  header.writeUInt16LE(42, 2);
  header.writeUInt32LE(8, 4); // offset IFD0

  const entryCount = 2;
  const ifd = Buffer.alloc(2 + entryCount * 12 + 4);
  ifd.writeUInt16LE(entryCount, 0);

  const dataStart = 8 + ifd.length;

  // Make
  ifd.writeUInt16LE(0x010f, 2);
  ifd.writeUInt16LE(2, 4); // ASCII
  ifd.writeUInt32LE(make.length, 6);
  ifd.writeUInt32LE(dataStart, 10);

  // Model
  ifd.writeUInt16LE(0x0110, 14);
  ifd.writeUInt16LE(2, 16);
  ifd.writeUInt32LE(model.length, 18);
  ifd.writeUInt32LE(dataStart + make.length, 22);

  ifd.writeUInt32LE(0, 2 + entryCount * 12); // tidak ada IFD berikutnya

  return Buffer.concat([header, ifd, make, model]);
}

function buildJpegWithExif() {
  const soi = Buffer.from([0xff, 0xd8]);

  // APP0 / JFIF
  const jfifBody = Buffer.concat([
    Buffer.from('JFIF\0', 'latin1'),
    Buffer.from([0x01, 0x02, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
  ]);
  const app0 = Buffer.concat([
    Buffer.from([0xff, 0xe0]),
    (() => { const l = Buffer.alloc(2); l.writeUInt16BE(jfifBody.length + 2); return l; })(),
    jfifBody,
  ]);

  // APP1 / Exif
  const exifBody = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), buildExifPayload()]);
  const app1 = Buffer.concat([
    Buffer.from([0xff, 0xe1]),
    (() => { const l = Buffer.alloc(2); l.writeUInt16BE(exifBody.length + 2); return l; })(),
    exifBody,
  ]);

  // Isi gambar tiruan + EOI
  const sos = Buffer.concat([Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]), Buffer.alloc(2048, 0x55)]);
  const eoi = Buffer.from([0xff, 0xd9]);

  return { jpeg: Buffer.concat([soi, app0, app1, sos, eoi]), app1 };
}

// ── Ambil fungsi internal dari ipc.js tanpa memuat Electron ──
function loadExifHelpers() {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(process.cwd(), 'electron', 'camera', 'ipc.js'), 'utf-8');

  const extract = src.slice(src.indexOf('function extractExifSegment'), src.indexOf('function toDisplayJpeg'));
  const factory = new Function(`${extract}\nreturn { extractExifSegment, insertExifSegment };`);
  return factory();
}

(async () => {
  console.log('Uji pelestarian EXIF saat foto diperkecil');

  const { extractExifSegment, insertExifSegment } = loadExifHelpers();
  const { jpeg: original, app1 } = buildJpegWithExif();

  console.log('\n[A] Ekstraksi segmen Exif dari JPEG kamera');
  const segment = extractExifSegment(original);
  check('segmen Exif ditemukan', !!segment);
  check('segmen identik dengan APP1 asli', !!segment && segment.equals(app1), segment ? `${segment.length} byte` : '');
  check('penanda Exif benar', !!segment && segment.subarray(4, 10).toString('latin1') === 'Exif\0\0');

  console.log('\n[B] Penyisipan ke JPEG hasil re-encode (tanpa metadata)');
  // Tiruan keluaran nativeImage.toJPEG(): SOI + APP0 + data, tanpa APP1
  const reencoded = Buffer.concat([
    original.subarray(0, 2),
    original.subarray(2, 2 + 2 + original.readUInt16BE(4)),
    Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]),
    Buffer.alloc(512, 0x77),
    Buffer.from([0xff, 0xd9]),
  ]);
  check('JPEG hasil re-encode memang kehilangan Exif', extractExifSegment(reencoded) === null);

  const restored = insertExifSegment(reencoded, segment);
  const restoredSegment = extractExifSegment(restored);
  check('Exif kembali ada setelah disisipkan', !!restoredSegment);
  check('isi Exif tidak berubah', !!restoredSegment && restoredSegment.equals(app1));
  check('JPEG tetap valid (SOI di awal)', restored[0] === 0xff && restored[1] === 0xd8);
  check('JPEG tetap valid (EOI di akhir)', restored[restored.length - 2] === 0xff && restored[restored.length - 1] === 0xd9);
  check('Exif disisipkan setelah APP0/JFIF', restored[2] === 0xff && restored[3] === 0xe0);

  console.log('\n[C] Data kamera terbaca di hasil akhir');
  const text = restored.toString('latin1');
  check('Make "Canon" ada di file', text.includes('Canon'));
  check('Model "Canon EOS 200D" ada di file', text.includes('Canon EOS 200D'));

  console.log('\n[D] Ketahanan terhadap input aneh');
  check('buffer bukan JPEG ditolak', extractExifSegment(Buffer.from([1, 2, 3, 4])) === null);
  check('buffer kosong ditolak', extractExifSegment(Buffer.alloc(0)) === null);
  check('insert tanpa segmen mengembalikan input apa adanya', insertExifSegment(reencoded, null) === reencoded);

  console.log(`\nHasil: ${passed} lulus, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
})();
