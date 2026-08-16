"use client";

import { useEffect, useRef, useState } from "react";
import localforage from "localforage";

// Helper to convert base64 dataurl to blob
function dataUrlToBlob(dataUrl: string): Blob {
  const arr = dataUrl.split(",");
  const mime = arr[0].match(/:(.*?);/)![1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

export default function BackgroundUploader() {
  const isProcessing = useRef(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    // [SATU-KALIAN PEMBERSIHAN]: Menghapus antrean lama secara otomatis
    const hasCleared = localStorage.getItem("did_clear_queue_v1");
    if (!hasCleared) {
      localforage.getItem<string[]>("offline_upload_keys").then(async keys => {
         if (keys && Array.isArray(keys)) {
           for (const key of keys) await localforage.removeItem(key);
         }
         await localforage.setItem("offline_upload_keys", []);
         localStorage.setItem("did_clear_queue_v1", "true");
         console.log("=========================================");
         console.log("[BackgroundUploader] SELURUH ANTREAN LAMA TELAH DIHANGUSKAN!");
         console.log("=========================================");
      });
    }

    // Jalankan pengecekan antrean setiap 30 detik
    const interval = setInterval(() => {
      processQueue();
    }, 30000);

    // Coba proses 5 detik setelah aplikasi pertama kali dimuat
    setTimeout(() => {
      processQueue();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const processQueue = async () => {
    if (isProcessing.current) return;
    isProcessing.current = true;

    try {
      const keysRaw = await localforage.getItem<string[]>("offline_upload_keys");
      let keys = keysRaw || [];

      if (keys.length === 0) {
        isProcessing.current = false;
        return; // Tidak ada yang perlu diupload
      }

      console.log(`[BackgroundUploader] Menemukan ${keys.length} antrean upload tertunda...`);

      // Proses satu per satu secara berurutan
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const task = await localforage.getItem<any>(key);
        
        if (!task) {
          // Task rusak atau hilang, hapus dari index
          keys = keys.filter(k => k !== key);
          await localforage.setItem("offline_upload_keys", keys);
          continue;
        }

        console.log(`[BackgroundUploader] Mencoba mengunggah ${key}...`);

        // Simpan backup lengkap ke lokal jika belum pernah disimpan (untuk task lama sebelum fitur ini)
        if (!task.saved_locally && task.finalImageBase64) {
          try {
            const backupPayload: any = {
              transaction_id: task.transaction_id || key,
              template_id: task.template_id,
              finalImageBase64: task.finalImageBase64,
            };

            // Sertakan foto-foto mentahan per frame jika ada
            if (task.photos && Array.isArray(task.photos)) {
              backupPayload.capturedPhotos = task.photos
                .map((p: any) => p.imageBase64)
                .filter(Boolean);
            }

            // Sertakan video jika ada (konversi blob ke base64)
            if (task.videoBlob && task.videoBlob instanceof Blob) {
              try {
                const base64data = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onloadend = () => {
                    if (typeof reader.result === 'string') resolve(reader.result);
                    else reject(new Error("FileReader result is not a string"));
                  };
                  reader.onerror = reject;
                  reader.readAsDataURL(task.videoBlob);
                });
                backupPayload.videoBase64 = base64data;
              } catch (vidErr) {
                console.warn('[BackgroundUploader] Gagal konversi video untuk backup lokal:', vidErr);
              }
            }

            await fetch('/api/save-failed-task', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(backupPayload)
            });
            task.saved_locally = true;
            await localforage.setItem(key, task);
            console.log(`[BackgroundUploader] Backup lokal lengkap dibuat untuk tugas ${key}`);
          } catch (saveErr) {
            console.error('[BackgroundUploader] Gagal membuat backup lokal:', saveErr);
          }
        }

        try {
          const result = await attemptUpload(task);
          if (result === "success") {
            console.log(`[BackgroundUploader] Tugas ${key} berhasil diunggah!`);
            // Berhasil! Hapus dari localforage
            await localforage.removeItem(key);
            keys = keys.filter(k => k !== key);
            await localforage.setItem("offline_upload_keys", keys);
            setRetryCount(prev => prev + 1);
          } else if (result === "server_error") {
            console.log(`[BackgroundUploader] Tugas ${key} memicu error server (500). Menambah retry_count.`);
            
            // Increment retry_count to prevent poisoning the queue
            task.retry_count = (task.retry_count || 0) + 1;
            if (task.retry_count >= 3) {
                console.warn(`[BackgroundUploader] Tugas ${key} gagal 3 kali. Backup sudah ada di lokal. Menghapus dari antrean.`);
                await localforage.removeItem(key);
                keys = keys.filter(k => k !== key);
                await localforage.setItem("offline_upload_keys", keys);
            } else {
                await localforage.setItem(key, task);
            }
            
            // Berhenti memproses antrean agar tidak membanjiri server yang sedang error
            break; 
          } else if (result === "network_error") {
             console.log(`[BackgroundUploader] Jaringan tidak stabil atau terputus. Tidak akan menambah retry_count untuk tugas ${key}. Menunggu koneksi pulih...`);
             break; // Stop antrean karena jaringan down
          }
        } catch (e) {
          console.error(`[BackgroundUploader] Kesalahan fatal saat mengunggah ${key}:`, e);
          break; // Stop antrean jika error koneksi tidak terduga
        }
      }
    } catch (err) {
      console.error("[BackgroundUploader] Proses antrean gagal:", err);
    } finally {
      isProcessing.current = false;
    }
  };

  const attemptUpload = async (task: any): Promise<"success" | "network_error" | "server_error"> => {
    // [VALIDASI WAJIB]: Pastikan file utama ada. Video tidak diwajibkan karena kanvas reguler/koran tidak merekam video.
    if (!task.finalImageBase64 || !task.photos || task.photos.length === 0) {
       console.warn(`[BackgroundUploader] Tugas ${task.id} mengandung file kosong (finalImage atau photos hilang). Tugas ini dianggap cacat dan akan dihentikan.`);
       // Kembalikan 'success' agar robot otomatis memusnahkan payload yang cacat ini dari antrean tanpa hit server.
       return "success"; 
    }

    const formData = new FormData();
    formData.append("transaction_id", task.transaction_id);
    formData.append("template_id", task.template_id);
    formData.append("token_final_image", task.token_final_image);
    
    // Jika finalImage disimpan sebagai obj (url) atau string (b64)
    formData.append("image", dataUrlToBlob(task.finalImageBase64), "final.jpg");

    // Foto per frame
    let uploadCount = 0;
    if (task.photos && Array.isArray(task.photos)) {
      task.photos.forEach((photo: any, index: number) => {
        if (photo.imageBase64 && photo.frame_id && uploadCount < 15) {
          const photoBlob = dataUrlToBlob(photo.imageBase64);
          formData.append(`photos[${uploadCount}][image]`, photoBlob, `photo_${uploadCount}.jpg`);
          formData.append(`photos[${uploadCount}][frame_id]`, photo.frame_id);
          uploadCount++;
        }
      });
    }

    // Video 
    if (task.videoBlob) {
      let videoToUpload: Blob = task.videoBlob;
      
      // Handle fallback form MP4 Convert logic in case the blob is raw webm locally
      if (task.videoBlob.type.includes("webm") || !task.videoBlob.type.includes("mp4")) {
        try {
          const convertForm = new FormData();
          convertForm.append("video", task.videoBlob, "input.webm");
          const convertRes = await fetch("/api/convert-video", {
            method: "POST",
            body: convertForm,
          });
          if (convertRes.ok && convertRes.headers.get("X-Conversion-Success") === "true") {
            const mp4ArrayBuffer = await convertRes.arrayBuffer();
            videoToUpload = new Blob([mp4ArrayBuffer], { type: "video/mp4" });
          } else {
             videoToUpload = new Blob([task.videoBlob], { type: "video/mp4" });
          }
        } catch (convErr) {
          videoToUpload = new Blob([task.videoBlob], { type: "video/mp4" });
        }
      }
      formData.append("video", videoToUpload, "final.mp4");
    }

    // GIF (antrean lama tidak punya field ini — dilewati begitu saja)
    if (task.gifBlob instanceof Blob) {
      formData.append("gif", task.gifBlob, "final.gif");
    }

    return new Promise<"success" | "network_error" | "server_error">((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/final-images");
      xhr.onload = () => {
        try {
          const res = JSON.parse(xhr.responseText);
          // If 200/201 (success) OR 422 (Validation Error/Duplicate), we must drop from queue to prevent infinite loop
          if (res.success || xhr.status === 200 || xhr.status === 201 || xhr.status === 422) {
             if (xhr.status === 422) {
                console.warn(`[BackgroundUploader] Backend returned 422 (Duplicate or Invalid). Dropping task to end loop.`);
             }
             resolve("success");
          } else {
             console.error(`[BackgroundUploader] Upload failed with Status ${xhr.status}:`, res);
             if (xhr.status >= 500) resolve("server_error");
             else resolve("network_error");
          }
        } catch (e) {
          console.error(`[BackgroundUploader] Invalid JSON response`, xhr.responseText);
          if (xhr.status >= 500) resolve("server_error");
          else resolve("network_error");
        }
      };
      xhr.onerror = () => resolve("network_error");
      // Timeout 60 detik untuk mencegah nyangkut
      xhr.timeout = 60000;
      xhr.ontimeout = () => resolve("network_error");
      xhr.send(formData);
    });
  };

  return null;
}
