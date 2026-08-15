# Camera Provider — digiCamControl & EOS Webcam Utility

Sumber kamera photobooth kini bisa dipilih saat runtime dari halaman Settings,
tanpa rebuild dan tanpa mengedit `.env` secara manual.

```
Canon EOS 200D
    │ USB
    ├─ digiCamControl ──── HTTP :5513 ──┐
    └─ EOS Webcam Utility ── getUserMedia ┤
                                          ▼
                            Electron Main (CameraProviderManager)
                                          │ IPC
                                    Next.js Renderer
                                          │
                                  UI photobooth (provider-agnostik)
```

## Struktur file

| File | Peran |
|---|---|
| `electron/camera/ICameraProvider.js` | Kontrak bersama |
| `electron/camera/WebcamProviderService.js` | Membungkus flow getUserMedia existing (tidak ditulis ulang) |
| `electron/camera/DigiCamControlService.js` | Klien HTTP digiCamControl |
| `electron/camera/CameraProviderManager.js` | Switch, rollback, kunci sesi, satu-satunya titik yang dipanggil IPC |
| `electron/camera/cameraConfig.js` | Persistensi `CAMERA_PROVIDER` di `.env` mutable |
| `electron/camera/ipc.js` | Registrasi channel IPC + bridge Main→Renderer |
| `app/hooks/useCamera.ts` | Hook agnostik provider untuk renderer |

## Persistensi

Pilihan disimpan sebagai `CAMERA_PROVIDER=webcam|digicamcontrol` di file `.env`
mutable yang sama dengan konfigurasi server — `%APPDATA%/RoamBooth Machine/.env`
di produksi, `./.env` saat development. Key `.env` lain tidak terganggu.

Base URL digiCamControl bisa dioverride lewat `DIGICAM_URL` (default
`http://127.0.0.1:5513`).

Folder hasil capture digiCamControl: `<userData>/camera-sessions/<timestamp>/`,
di-set eksplisit ke digiCamControl lewat `session.folder` saat sesi dimulai.

## Persiapan digiCamControl

1. Install dan jalankan digiCamControl di PC yang terhubung ke Canon EOS 200D.
2. `Settings → Webserver → Use web server`, lalu **restart digiCamControl**.
3. Tutup EOS Webcam Utility — dua aplikasi tidak bisa memegang device USB yang sama.
4. Verifikasi: `npm run test:digicam`

## Batasan yang disengaja

- **Kanvas Flipbook selalu memakai Webcam Utility.** Flipbook merekam video lewat
  `MediaRecorder` dari `MediaStream`; digiCamControl tidak menyediakan MediaStream.
  Hal yang sama berlaku untuk video per-frame di `/camera`.
- **`getUserMedia` hanya ada di renderer.** Main Process tidak memegang MediaStream;
  `WebcamProviderService.stopLiveView()` mengirim perintah ke renderer lewat bridge
  dan renderer yang memanggil `track.stop()`.
- **Health check webcam bersifat optimistis saat idle.** Kalau tidak ada halaman
  kamera yang terbuka, webcam tetap dianggap siap supaya rollback tidak pernah
  meninggalkan aplikasi tanpa kamera aktif.

## Testing

### Otomatis

```bash
npm run test:camera-config
```
Tanpa hardware dan tanpa Electron. Mencakup skenario 6–9: toggle dua arah,
provider lama berhenti bersih, rollback saat digiCamControl mati, penolakan
switch saat sesi berjalan, dan persistensi `.env`.

```bash
npm run test:digicam
```
Butuh digiCamControl aktif + kamera terhubung. Mencakup skenario 1–4: health
check, deteksi kamera, live view + frame (termasuk fps efektif), dan
capture → `lastcaptured` → download image. Opsi: `-- --skip-capture`,
`-- --url http://127.0.0.1:5513`.

### Regresi manual (skenario 5)

Dengan provider = **Webcam Utility**, seluruh poin ini harus identik dengan
sebelum migrasi:

- [ ] `/camera` membuka kamera otomatis, preview muncul, `preferredCameraId` dihormati
- [ ] Tombol mirror membalik preview
- [ ] Countdown 3-2-1 → flash → preview foto
- [ ] Filter, brightness, contrast bekerja di preview dan tersimpan di hasil akhir
- [ ] ULANGI / LANJUT / SELESAI berperilaku sama
- [ ] Video per-frame terekam (cek `liveVideos` di localforage)
- [ ] `/render`, `/print`, QR, dan upload menerima foto seperti biasa
- [ ] `/flipbook-camera` berjalan penuh
- [ ] Timer sesi dan modal timeout tidak berubah

### Manual digiCamControl (skenario 6–9 di UI)

- [ ] Settings → Sumber Kamera → DigiCamControl: indikator jadi hijau `Connected`
- [ ] `/camera` menampilkan live view JPEG, capture menghasilkan foto di template
- [ ] Kembali ke Webcam Utility: live view digiCamControl berhenti, getUserMedia jalan lagi
- [ ] Matikan digiCamControl lalu pilih DigiCamControl: muncul error merah, pilihan
      otomatis balik ke Webcam Utility, aplikasi tidak crash
- [ ] Buka `/camera`, lalu dari perangkat lain ganti provider: ditolak dengan pesan
      "Selesaikan atau batalkan sesi saat ini sebelum mengganti sumber kamera"
