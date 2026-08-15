# PROMPT: Migrasi Camera Layer Photobooth ke digiCamControl (dengan Toggle On/Off di Settings)

Saya memiliki aplikasi photobooth desktop menggunakan Next.js + Electron.

Saat ini camera layer menggunakan:

```
Canon EOS 200D
    ↓ USB
Canon EOS Webcam Utility
    ↓
Windows Webcam Device
    ↓
Next.js / Electron (getUserMedia)
```

Saya ingin MENAMBAHKAN dukungan digiCamControl sebagai provider kamera baru,
**BUKAN menggantikan EOS Webcam Utility secara permanen.**

Kedua provider harus tetap ada dan bisa dipilih/di-switch oleh user kapan saja
lewat halaman **Settings**, tanpa perlu rebuild atau edit `.env`.

====================================================
ARSITEKTUR YANG DIINGINKAN
====================================================

```
Canon EOS 200D
    ↓ USB
[ digiCamControl ]  ATAU  [ EOS Webcam Utility ]   ← dipilih via Settings
    ↓                           ↓
digiCamControl Web Server   Windows Webcam Device
    ↓ HTTP                      ↓ getUserMedia
Electron Main Process ────────────┘
    ↓ IPC
Next.js Renderer
    ↓
Photobooth UI (tidak tahu provider mana yang aktif)
```

PENTING:

- Next.js TIDAK berkomunikasi langsung dengan kamera atau digiCamControl.
- Next.js TIDAK menggunakan OpenCV.
- Electron berkomunikasi dengan digiCamControl melalui HTTP Web Server.
- **Provider kamera adalah pilihan runtime, bukan pilihan build-time.**

====================================================
FITUR BARU WAJIB: TOGGLE PROVIDER DI SETTINGS
====================================================

Tambahkan section baru di halaman Settings yang sudah ada:

**"Sumber Kamera" / "Camera Source"**

- Pilihan: `DigiCamControl` | `Webcam Utility (Default)`
- Default: `Webcam Utility` (provider lama, supaya app tetap jalan seperti
  sebelumnya untuk user yang belum setup digiCamControl).
- Perubahan pilihan **disimpan secara persisten** (mis. lewat `electron-store`
  atau file config yang sudah dipakai app ini), bukan hanya di React state.
- Perubahan berlaku **tanpa restart aplikasi**.

Behavior saat toggle:

1. User pilih provider baru di Settings.
2. Electron Main Process:
   - Hentikan provider yang sedang aktif dengan bersih:
     - Kalau digiCamControl aktif → panggil `stopLiveView()`, lepas polling,
       tutup koneksi HTTP yang masih pending.
     - Kalau Webcam Utility aktif → stop `MediaStream` tracks yang berjalan.
   - Inisialisasi provider baru.
   - Jalankan `healthCheck()` provider baru.
   - Kirim event ke renderer (`camera:providerChanged`) berisi status baru
     (`connected`, `provider`, `error?`).
3. Kalau provider baru **gagal** health check (mis. digiCamControl belum
   dijalankan di Windows), tampilkan error yang jelas di Settings **dan
   otomatis tetap pakai/rollback ke provider sebelumnya** — jangan biarkan
   app dalam keadaan "tidak ada kamera aktif sama sekali".
4. Kalau ada sesi photobooth yang sedang berjalan (mis. di tengah countdown
   atau live view aktif) saat provider diganti, tolak perpindahan dan
   tampilkan pesan "Selesaikan atau batalkan sesi saat ini sebelum
   mengganti sumber kamera" — jangan switch provider di tengah capture flow.

**SYARAT UTAMA (non-negotiable):**

> Ketika provider di-set ke `Webcam Utility`, seluruh fungsi yang SEKARANG
> sudah berjalan (getUserMedia, preview, capture lewat webcam) **harus tetap
> bekerja persis seperti sebelum migrasi ini dibuat** — tidak boleh ada
> regresi sama sekali. Kode `WebcamProvider` yang sudah ada **jangan
> ditulis ulang**, hanya dibungkus di balik interface provider yang sama
> dengan `DigiCamControlProvider`.

====================================================
DIGICAMCONTROL WEB SERVER
====================================================

digiCamControl harus dijalankan di Windows PC yang terhubung ke Canon EOS 200D.

Aktifkan: `Settings → Webserver → Use web server`, lalu restart digiCamControl.

Default Web Server: `http://127.0.0.1:5513`

Endpoint yang perlu dites manual dulu di browser SEBELUM ditulis kode
(jangan asumsikan semua tersedia tanpa pengujian):

- `GET http://127.0.0.1:5513` — cek server hidup
- `GET http://127.0.0.1:5513/?CMD=LiveViewWnd_Show` — mulai live view
- `GET http://127.0.0.1:5513/?CMD=LiveViewWnd_Hide` — hentikan live view
- `GET http://127.0.0.1:5513/liveview.jpg` — frame live view saat ini
  (tambahkan cache-busting query, mis. `?t=<timestamp>`, karena URL statis
  ini gampang di-cache oleh `<img>`)
- `GET http://127.0.0.1:5513/?CMD=Capture` — trigger shutter
- `GET http://127.0.0.1:5513/?slc=get&param1=lastcaptured&param2=` — cek
  nama file hasil capture terakhir (bukan indikasi file sudah selesai ditulis)
- `GET http://127.0.0.1:5513/preview.jpg` — alternatif lebih ringan untuk
  ambil foto yang sedang terpilih/terakhir, tanpa perlu tahu nama filenya
- `GET http://127.0.0.1:5513/image/<filename>` — download file by name
- `GET http://127.0.0.1:5513/session.json` — data sesi saat ini
- `GET http://127.0.0.1:5513/?slc=set&param1=session.folder&param2=<path>` —
  atur folder penyimpanan hasil capture di sisi digiCamControl. **Set ini
  eksplisit ke folder session photobooth Anda**, jangan andalkan folder
  default digiCamControl.

Buat camera service yang melakukan health check terlebih dahulu, bukan
mengasumsikan endpoint tersedia.

Jangan asumsikan endpoint MJPEG stream tambahan (mis. di port lain) tersedia
tanpa verifikasi manual — dokumentasi resmi hanya mengonfirmasi endpoint di
atas via port 5513.

====================================================
KONEKSI CAMERA & KONFLIK DEVICE
====================================================

digiCamControl dan EOS Webcam Utility **tidak bisa memegang device USB yang
sama secara bersamaan**. Karena itu:

- Toggle provider di Settings harus disertai instruksi ke user: "Pastikan
  hanya satu aplikasi (digiCamControl ATAU EOS Webcam Utility) yang berjalan
  di background saat memilih provider ini."
- Pertimbangkan menambahkan indikator status di Settings yang menunjukkan
  provider mana yang sedang aktif dan status koneksinya (connected/error),
  supaya user tidak bingung kalau kedua software rebutan device.

====================================================
ELECTRON CAMERA SERVICE (INTERFACE BERSAMA)
====================================================

Buat interface `ICameraProvider` yang diimplementasikan oleh dua class:

```
ICameraProvider
├── healthCheck()
├── getStatus()
├── startLiveView()
├── stopLiveView()
├── capture()
├── getLastCaptured()
└── downloadPhoto(filename)

WebcamProviderService implements ICameraProvider   ← wrap kode existing, jangan rewrite
DigiCamControlService  implements ICameraProvider   ← baru
```

Tambahkan `CameraProviderManager` di Main Process yang:

- Membaca provider aktif dari settings/config.
- Meng-instantiate provider yang sesuai.
- Menangani proses switch provider (lihat behavior toggle di atas).
- Menjadi satu-satunya titik yang dipanggil oleh IPC handler — IPC handler
  tidak perlu tahu provider mana yang sedang aktif.

Contoh `healthCheck()` untuk digiCamControl:

```
GET http://127.0.0.1:5513
```

Jika gagal:

```js
return {
  connected: false,
  error: "DigiCamControl Web Server tidak tersedia"
}
```

====================================================
LIVE VIEW
====================================================

**digiCamControl:**
- Start: `GET /?CMD=LiveViewWnd_Show`
- Frame: `GET /liveview.jpg?t=<timestamp>`
- Stop: `GET /?CMD=LiveViewWnd_Hide`

**Webcam Utility (existing):** tetap pakai flow `getUserMedia()` yang sudah
ada, tidak diubah.

Prioritaskan Live View yang stabil dan CPU usage rendah. Jangan menambahkan
polling frame lebih cepat dari yang benar-benar dibutuhkan UI (mis. 10–15
fps sudah cukup untuk preview photobooth).

====================================================
CAPTURE FLOW
====================================================

Flow ini berlaku untuk **provider digiCamControl saja**. Flow capture untuk
Webcam Utility tetap seperti kode existing.

Ketika user menekan TAKE PHOTO:

1. Tentukan provider aktif dari `CameraProviderManager`.
2. (digiCamControl) Check Web Server + status kamera.
3. Pastikan Live View aktif.
4. Jalankan countdown.
5. Kirim `GET /?CMD=Capture`.
6. Poll `GET /?slc=get&param1=lastcaptured&param2=` dengan **batas waktu
   maksimum (mis. 10 detik) dan interval polling wajar (mis. 300ms)** —
   jangan poll tanpa batas. Kalau timeout, kembalikan error yang jelas ke UI
   ("Kamera tidak merespon, coba lagi") daripada hang.
7. Tunggu sampai response bukan `-`.
8. Ambil filename, download via `GET /image/<filename>` (atau gunakan
   `/preview.jpg` sebagai alternatif lebih sederhana bila cocok).
9. Simpan file ke folder session photobooth (folder yang sama yang sudah
   di-set lewat `session.folder` di atas).
10. Return local file path.
11. Tampilkan preview di Next.js — sama seperti flow existing untuk
    Webcam Utility, supaya UI hilir (frame, print, QR, upload) tidak perlu
    tahu dari provider mana file itu berasal.

Jangan menganggap HTTP response dari `Capture` berarti JPG sudah selesai.

====================================================
ELECTRON IPC
====================================================

Next.js tidak boleh melakukan HTTP request langsung ke digiCamControl.

```
Renderer
   ↓ IPC
Electron Main (CameraProviderManager)
   ↓ HTTP / getUserMedia (tergantung provider aktif)
digiCamControl Web Server  atau  Windows Webcam Device
```

Expose lewat preload + `contextBridge` (jangan aktifkan `nodeIntegration`):

```js
window.camera.healthCheck()
window.camera.getStatus()
window.camera.startLiveView()
window.camera.stopLiveView()
window.camera.capture()

// baru, untuk fitur toggle:
window.camera.getProvider()          // provider aktif saat ini
window.camera.setProvider(name)      // 'digicamcontrol' | 'webcam'
window.camera.onProviderChanged(cb)  // subscribe event dari main process
```

====================================================
LIVE VIEW UI / HOOK
====================================================

`useCamera()` tetap agnostik terhadap provider:

```
connected
liveViewUrl / liveViewState
isCapturing
error
activeProvider        ← baru, hanya untuk ditampilkan di Settings, bukan
                         untuk logic di komponen UI photobooth
startLiveView()
stopLiveView()
capture()
```

`useCamera()` juga subscribe ke `window.camera.onProviderChanged()` supaya
UI otomatis reset/refresh saat provider berubah dari Settings.

UI photobooth (halaman capture, frame, print, dsb.) **tidak boleh tahu**
detail digiCamControl maupun Webcam Utility.

====================================================
CURRENT SYSTEM — JANGAN RUSAK
====================================================

Aplikasi sekarang sudah punya: countdown, camera preview, photo capture UI,
photo frame, image processing, printing, QR, upload, session, Electron.

- Jangan hapus fitur tersebut.
- Jangan rewrite seluruh aplikasi.
- Jangan rewrite `WebcamProvider` yang sudah ada — hanya bungkus di balik
  `ICameraProvider`.
- Setelah migrasi ini, dengan provider = `Webcam Utility`, seluruh flow
  harus identik dengan sebelum migrasi (regression test manual: bandingkan
  behavior sebelum & sesudah).

====================================================
TESTING
====================================================

Buat test yang bisa dijalankan terpisah:

1. Web server health check (digiCamControl)
2. Camera detected (digiCamControl)
3. Start Live View + terima frame (digiCamControl)
4. Capture → deteksi `lastcaptured` → download image (digiCamControl)
5. Full flow existing dengan Webcam Utility (regresi — harus tetap lulus
   tanpa perubahan)
6. **Toggle provider dari Settings: Webcam → DigiCamControl**, verifikasi
   provider lama berhenti bersih dan provider baru mulai bekerja
7. **Toggle provider dari Settings: DigiCamControl → Webcam**, verifikasi
   app kembali ke behavior awal tanpa sisa state/koneksi dari
   digiCamControl
8. Toggle ke digiCamControl saat Web Server digiCamControl **tidak
   berjalan** → pastikan app menampilkan error dan tetap fallback ke
   provider sebelumnya, bukan crash atau kamera mati total
9. Coba ganti provider saat sesi capture sedang berjalan → harus ditolak
   dengan pesan yang jelas

====================================================
LANGKAH SEBELUM MENULIS KODE
====================================================

Sebelum menulis kode, analisis repository saya dan tunjukkan:

1. File mana yang berisi `WebcamProvider` / logic kamera saat ini.
2. File halaman Settings yang sudah ada (untuk tempat menambahkan toggle).
3. Struktur Electron main/preload saat ini (untuk tempat menambahkan
   `CameraProviderManager` dan IPC handler baru).
4. Di mana konfigurasi/persisted settings app ini disimpan saat ini
   (supaya pilihan provider disimpan dengan cara yang konsisten dengan
   pattern yang sudah ada, bukan mekanisme baru).
