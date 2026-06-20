"use client";

import React, { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import QRCode from "react-qr-code";
import localforage from "localforage";
import { Mochiy_Pop_One } from "next/font/google";

const mochiyPopOne = Mochiy_Pop_One({
  subsets: ["latin"],
  weight: "400",
});

// ── Helpers ──────────────────────────────────────────────
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

function generateToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Types ──────────────────────────────────────────────
type UploadStage = "idle" | "uploading" | "success" | "error";

type QrisChargeData = {
  qr_string?: string | null;
  qr_image_url?: string | null;
  order_id?: string;
  is_iframe?: boolean;
  is_snap?: boolean;
  snap_token?: string;
};

type PaymentGatewayPayload = Record<string, string | number | boolean | undefined> & {
  name?: string;
  server_key?: string;
};

function amountPrintForCanvas(
  pg: PaymentGatewayPayload | null,
  canvasType: string
): number {
  if (!pg) return 0;
  const v = pg[`amount_print_${canvasType}`];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ── QRIS Payment Modal ───────────────────────────────────
function QrisModal({
  basePrice,
  gatewayName,
  onClose,
  qrisState,
  qrisData,
  timeLeft
}: {
  basePrice: number;
  gatewayName: string;
  onClose: () => void;
  qrisState: string;
  qrisData: QrisChargeData | null;
  timeLeft: number;
}) {
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    }).format(price);
  };

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300">
      <div className={`bg-white p-10 rounded-[2.5rem] shadow-2xl flex flex-col items-center w-full animate-in zoom-in-95 duration-500 border-[8px] border-[#f15a09] transition-all ${qrisData?.is_iframe ? "max-w-2xl" : "max-w-md"}`}>
        <h2 className={`${mochiyPopOne.className} text-[#f15a09] text-xl mb-6 uppercase tracking-widest`}>TAMBAH CETAK</h2>
        
        {qrisState === "loading" && (
          <div className="flex flex-col items-center py-10">
            <div className="w-16 h-16 border-8 border-orange-100 border-t-[#f15a09] rounded-full animate-spin mb-4"></div>
            <p className="font-bold text-slate-400">Membuat Barcode...</p>
          </div>
        )}

        {qrisState === "error" && (
           <div className="text-center py-6">
              <p className="text-rose-500 font-bold mb-6">Gagal memuat sistem pembayaran.</p>
              <button onClick={onClose} className="w-full py-4 rounded-2xl bg-slate-100 font-bold text-slate-500">TUTUP</button>
           </div>
        )}

        {(qrisState === "ready" || qrisState === "success") && (
          <div
            className={`relative flex w-full animate-in flex-col items-center overflow-hidden transition-all duration-700`}
          >
            {!qrisData?.is_iframe && (
              <>
                <div className="text-center mb-6">
                  <p className="text-xs font-black text-slate-300 uppercase tracking-widest leading-none mb-1">TOTAL BAYAR</p>
                  <p className="text-3xl font-black text-slate-800">{formatPrice(basePrice)}</p>
                </div>
              </>
            )}

            <div className={`relative flex items-center justify-center rounded-[2rem] border-2 border-slate-100 bg-slate-50 shadow-sm transition-all duration-700 ${qrisData?.is_iframe ? "h-[min(72vh,560px)] w-full p-0" : "h-64 w-64 p-4"} ${qrisState === "success" ? "absolute scale-0 opacity-0" : "scale-100 opacity-100"}`}>
              {qrisData?.is_iframe && qrisData?.qr_image_url ? (
                <iframe
                  src={qrisData.qr_image_url}
                  title="Pembayaran"
                  className="h-full w-full rounded-2xl border-0 bg-white"
                  sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-modals"
                />
              ) : qrisData?.qr_string ? (
                <div className="bg-white p-2 rounded-xl">
                  <QRCode value={qrisData.qr_string} size={200} bgColor={"transparent"} fgColor={"#1e293b"} level={"H"} />
                </div>
              ) : qrisData?.qr_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrisData.qr_image_url} alt="QRIS" className="h-full w-full object-contain mix-blend-multiply" />
              ) : (
                <QRCode value={"MOCK"} size={200} />
              )}
            </div>

            {qrisState === 'success' && (
              <div className="flex flex-col items-center justify-center py-10 animate-in fade-in duration-500">
                <div className="w-20 h-20 bg-emerald-100 text-emerald-500 rounded-full flex items-center justify-center mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </div>
                <span className="font-black text-emerald-600 uppercase">BERHASIL!</span>
              </div>
            )}

            {qrisState !== "success" && (
              <div className="text-center mt-6 mb-8 w-full">
                <p className="text-[10px] font-black text-slate-300 uppercase leading-none mb-1">BATAS WAKTU BAYAR</p>
                <p className="text-xl font-black text-[#f15a09] tabular-nums">{minutes}:{seconds.toString().padStart(2, '0')}</p>
              </div>
            )}
          </div>
        )}

        {(qrisState === "ready" || qrisState === "success") && (
          <button onClick={onClose} className="w-full py-4 rounded-2xl bg-slate-50 text-slate-400 font-black text-xs uppercase tracking-widest hover:bg-slate-100 transition-colors">BATAL</button>
        )}
      </div>
    </div>
  );
}

// ── Main Print Content ───────────────────────────────────
function PrintContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const canvasType = searchParams.get("kanvas") || "reguler";
  const templateId = searchParams.get("template") || "1";

  // Data States
  const [finalImage, setFinalImage] = useState<string | null>(null);
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [pricing, setPricing] = useState<PaymentGatewayPayload | null>(null);
  const [downloadToken] = useState(() => generateToken());

  // UI States
  const [previewMode, setPreviewMode] = useState<"photo" | "live" | "gif">("photo");
  const [uploadStage, setUploadStage] = useState<UploadStage>("idle");
  const [finalImageDbId, setFinalImageDbId] = useState<number | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [hasPrinted, setHasPrinted] = useState(false);
  const [selectedPrintSize, setSelectedPrintSize] = useState<"4R" | "2R">("4R");
  const [printCopies, setPrintCopies] = useState(1);
  const [rawPhotos, setRawPhotos] = useState<string[]>([]);
  const [currentGifIndex, setCurrentGifIndex] = useState(0);
  const [templateCategory, setTemplateCategory] = useState<string>("");

  const [isQrisModalOpen, setIsQrisModalOpen] = useState(false);
  const [qrisState, setQrisState] = useState<"loading" | "ready" | "success" | "error">("loading");
  const [qrisData, setQrisData] = useState<QrisChargeData | null>(null);
  const [timeLeft, setTimeLeft] = useState(300);
  const [pendingPrintQty, setPendingPrintQty] = useState(1);
  const [pendingPrintAmount, setPendingPrintAmount] = useState(0);

  const uploadStarted = useRef(false);
  const activeXhrRef = useRef<XMLHttpRequest | null>(null);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const uploadPromiseRef = useRef<Promise<number | null> | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  // ── Load Data ──────────────────────────
  useEffect(() => {
    const loadData = async () => {
      const img = localStorage.getItem("finalRenderImage");
      const pricingRaw = localStorage.getItem("paymentGateway");
      setFinalImage(img);
      if (pricingRaw) setPricing(JSON.parse(pricingRaw));

      const videoBlob = await localforage.getItem<Blob>("finalLiveVideo");
      if (videoBlob) {
        setFinalVideoUrl(URL.createObjectURL(videoBlob));
      }

      const raw = localStorage.getItem("capturedPhotos") || localStorage.getItem("rawPhotos");
      if (raw) setRawPhotos(JSON.parse(raw));

      // Read template category
      const templatesRaw = localStorage.getItem("templates");
      if (templatesRaw) {
        try {
          const templates = JSON.parse(templatesRaw);
          const tpl = templates.find((t: any) => t.id?.toString() === templateId);
          if (tpl?.category) setTemplateCategory(tpl.category);
        } catch (e) { /* ignore */ }
      }
    };
    loadData();
    localStorage.removeItem("session_expiry");
  }, []);

  // ── Helper: Save All Files Locally ─────
  const saveAllFilesLocally = async () => {
    try {
      const storedFinal = localStorage.getItem("finalRenderImage");
      const storedTx = localStorage.getItem("transactionDbId");
      if (!storedFinal || !storedTx) return;

      const capturedPhotosRaw = localStorage.getItem("capturedPhotos");
      const rawPhotosRaw = localStorage.getItem("rawPhotos");

      const payload: any = {
        transaction_id: storedTx,
        template_id: templateId,
        finalImageBase64: storedFinal,
        rawPhotos: JSON.parse(rawPhotosRaw || "[]"),
        capturedPhotos: JSON.parse(capturedPhotosRaw || "[]"),
      };

      // Convert video blob to base64 for the API
      const videoBlob = await localforage.getItem<Blob>("finalLiveVideo");
      if (videoBlob) {
        try {
          const base64data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              if (typeof reader.result === 'string') resolve(reader.result);
              else reject(new Error("FileReader result is not a string"));
            };
            reader.onerror = reject;
            reader.readAsDataURL(videoBlob);
          });
          payload.videoBase64 = base64data;
        } catch (vidErr) {
          console.warn('[Print] Gagal mengkonversi video ke base64 untuk backup lokal:', vidErr);
        }
      }

      await fetch('/api/save-failed-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      console.log(`[Print] Semua file backup lokal disimpan untuk transaksi: ${storedTx}`);
    } catch (err) {
      console.error('[Print] Gagal menyimpan backup lokal lengkap:', err);
    }
  };

  // ── Background Upload ─────────────────
  const performUpload = useCallback(async () => {
    if (uploadStarted.current) return uploadPromiseRef.current;
    uploadStarted.current = true;

    const abortController = new AbortController();
    activeAbortControllerRef.current = abortController;

    const uploadTask = (async () => {
      try {
        const storedFinalImage = localStorage.getItem("finalRenderImage");
        const storedTxDbId = localStorage.getItem("transactionDbId");
        if (!storedFinalImage || !storedTxDbId) return null;

        setUploadStage("uploading");
        setUploadProgress(0);
        const dbTxId = parseInt(storedTxDbId);

        const formData = new FormData();
        formData.append("transaction_id", dbTxId.toString());
        formData.append("template_id", templateId);
        formData.append("token_final_image", downloadToken);
        formData.append("image", dataUrlToBlob(storedFinalImage), "final.jpg");

        // ── Tambahkan Foto-Foto Per Frame ──
        const capturedPhotosRaw = localStorage.getItem("capturedPhotos");
        const rawPhotosRaw = localStorage.getItem("rawPhotos");
        const templatesRaw = localStorage.getItem("templates");
        
        const capturedPhotos = JSON.parse(capturedPhotosRaw || "[]");
        const rawPhotos = JSON.parse(rawPhotosRaw || "[]");
        const templates = JSON.parse(templatesRaw || "[]");
        
        const photosToSend = capturedPhotos.length > 0 ? capturedPhotos : rawPhotos;
        const template = templates.find((t: any) => t.id.toString() === templateId);
        const frames = template?.frames || [];

        let uploadCount = 0;
        photosToSend.forEach((photo: string, index: number) => {
          if (photo && frames[index] && uploadCount < 15) {
            const photoBlob = dataUrlToBlob(photo);
            formData.append(`photos[${uploadCount}][image]`, photoBlob, `photo_${index}.jpg`);
            formData.append(`photos[${uploadCount}][frame_id]`, frames[index].id.toString());
            uploadCount++;
          }
        });

        if (abortController.signal.aborted) throw new Error("Aborted beforehand");

        // ── Tambahkan Video Live (converted to MP4 for iOS/Android compatibility) ──
        const finalVideoBlob = await localforage.getItem<Blob>("finalLiveVideo");
        if (finalVideoBlob) {
          let videoToUpload: Blob = finalVideoBlob;
          
          if (finalVideoBlob.type.includes("webm") || !finalVideoBlob.type.includes("mp4")) {
            try {
              const convertForm = new FormData();
              convertForm.append("video", finalVideoBlob, "input.webm");
              const convertRes = await fetch("/api/convert-video", {
                method: "POST",
                body: convertForm,
                signal: abortController.signal
              });
              if (convertRes.ok && convertRes.headers.get("X-Conversion-Success") === "true") {
                const mp4ArrayBuffer = await convertRes.arrayBuffer();
                videoToUpload = new Blob([mp4ArrayBuffer], { type: "video/mp4" });
              } else {
                videoToUpload = new Blob([finalVideoBlob], { type: "video/mp4" });
              }
            } catch (convErr) {
              videoToUpload = new Blob([finalVideoBlob], { type: "video/mp4" });
            }
          }
          
          formData.append("video", videoToUpload, "final.mp4");
        }

        if (abortController.signal.aborted) throw new Error("Aborted before XHR");

        // Use XMLHttpRequest for upload progress tracking
        const { data, status } = await new Promise<any>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          activeXhrRef.current = xhr;
          xhr.open("POST", "/api/final-images");
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              setUploadProgress(Math.round((e.loaded / e.total) * 100));
            }
          };
          xhr.onload = () => {
            try { resolve({ data: JSON.parse(xhr.responseText), status: xhr.status }); }
            catch { reject(new Error("Invalid response")); }
          };
          xhr.onerror = () => reject(new Error("Upload failed"));
          xhr.onabort = () => reject(new Error("Upload aborted forcefully"));
          xhr.send(formData);
        });

        if (data.success || status === 200 || status === 201) {
          setFinalImageDbId(data?.data?.id || 0);
          setUploadStage("success");
          setUploadProgress(100);

          // Tetap simpan backup lokal lengkap walaupun upload berhasil (tidak mengganggu alur utama)
          try {
            await saveAllFilesLocally();
          } catch (localErr) {
            console.error('[Print] Backup lokal gagal setelah upload berhasil (tidak masalah):', localErr);
          }

          return data?.data?.id || null;
        }
        
        throw new Error("Upload response not success");
      } catch (e) {
        setUploadStage("error");
        await handleOfflineFallback();
        return null;
      }
    })();
    uploadPromiseRef.current = uploadTask;
    return uploadTask;
  }, [templateId, downloadToken]);

  const handleOfflineFallback = async () => {
    try {
      const storedFinalImage = localStorage.getItem("finalRenderImage");
      const storedTxDbId = localStorage.getItem("transactionDbId");
      if (!storedFinalImage || !storedTxDbId) return;

      const capturedPhotosRaw = localStorage.getItem("capturedPhotos");
      const rawPhotosRaw = localStorage.getItem("rawPhotos");
      const templatesRaw = localStorage.getItem("templates");
      
      const capturedPhotos = JSON.parse(capturedPhotosRaw || "[]");
      const rawPhotos = JSON.parse(rawPhotosRaw || "[]");
      const templates = JSON.parse(templatesRaw || "[]");
      const photosToSend = capturedPhotos.length > 0 ? capturedPhotos : rawPhotos;
      const template = templates.find((t: any) => t.id.toString() === templateId);
      const frames = template?.frames || [];

      let offlineCount = 0;
      const payloadPhotos = photosToSend.map((photo: string, index: number) => {
         return { imageBase64: photo, frame_id: frames[index]?.id?.toString() }
      }).filter((p: any) => {
         if (p.imageBase64 && p.frame_id && offlineCount < 15) {
             offlineCount++;
             return true;
         }
         return false;
      });

      const finalVideoBlob = await localforage.getItem<Blob>("finalLiveVideo");

      const queueId = "offline_upload_" + Date.now() + "_" + Math.floor(Math.random()*1000);
      const queueData = {
        id: queueId,
        transaction_id: storedTxDbId,
        template_id: templateId,
        token_final_image: downloadToken,
        finalImageBase64: storedFinalImage,
        photos: payloadPhotos,
        videoBlob: finalVideoBlob || null,
        timestamp: Date.now()
      };

      await localforage.setItem(queueId, queueData);
      
      const existingKeys = await localforage.getItem<string[]>("offline_upload_keys") || [];
      if (!existingKeys.includes(queueId)) {
         existingKeys.push(queueId);
         await localforage.setItem("offline_upload_keys", existingKeys);
      }
      console.log("[Print] Disimpan ke Offline Upload Queue:", queueId);

      // Langsung simpan semua file ke komputer lokal (tidak mengganggu antrian jika gagal)
      try {
        await saveAllFilesLocally();
      } catch (localSaveErr) {
        console.error('[Print] Backup lokal gagal, tapi antrian tetap aman:', localSaveErr);
      }
    } catch(err) {
      console.error("[Print] Gagal nge-save Offline Queue", err);
    }
  };

  useEffect(() => {
    if (finalImage && !uploadStarted.current) performUpload();
  }, [finalImage, performUpload]);

  // ── Print Logic ──────────────────────
  const handlePrint = async (isExtra = false, customQty?: number, customSize?: string, isAutoPrint = false) => {
    if (isPrinting) return;
    setIsPrinting(true);
    try {
      let dbId = finalImageDbId;
      if (!dbId && uploadPromiseRef.current) {
        // Try to get dbId but don't wait forever — use 0 as fallback for local-only print
        dbId = await Promise.race([
          uploadPromiseRef.current,
          new Promise<null>(r => setTimeout(() => r(null), 500))
        ]);
      }

      const standardPrinter = localStorage.getItem("preferredPrinterName") || "";
      const splitPrinter = localStorage.getItem("preferredPrinterSplitName") || "";
      const orientation = localStorage.getItem("printerOrientation") || "landscape";
      
      const printSize = customSize || selectedPrintSize;
      let targetPrinter = standardPrinter;
      if (printSize === "2R") {
          targetPrinter = splitPrinter || standardPrinter;
      }

      const rawPrintPrice = amountPrintForCanvas(pricing, canvasType);
      const finalPrice = isExtra ? Math.round(Number(rawPrintPrice)) : 0;
      const targetQty = customQty || printCopies;

      const response = await fetch(`/api/final-images/${dbId || 0}/print`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount_print: finalPrice,
          print_quantity: isExtra ? targetQty : 1,
          printer_name: targetPrinter,
          printer_orientation: orientation,
          image_data: localStorage.getItem("finalRenderImage"),
          copies: isExtra ? targetQty : 1,
          print_size: printSize
        }),
      });
      const data = await response.json();
      if (data.success) {
        if (!isExtra) setHasPrinted(true);
        if (!isAutoPrint) alert("Selesai! Foto Anda sedang dicetak.");
      } else {
        if (!isAutoPrint) alert("Gagal mencetak: " + (data.message || "Pastikan printer online."));
      }
    } catch (e) {
      if (!isAutoPrint) alert("Terjadi kesalahan sistem saat mencoba mencetak.");
    } finally {
      setIsPrinting(false);
    }
  };

  useEffect(() => {
    const doAutoPrint = async () => {
      const storedTxId = localStorage.getItem("transactionDbId");
      if (!storedTxId) return;
      
      const autoPrintedKey = `auto_printed_${storedTxId}`;
      if (!localStorage.getItem(autoPrintedKey)) {
        localStorage.setItem(autoPrintedKey, "1");
        
        let cat = templateCategory.toUpperCase();
        if (!cat) {
          const templatesRaw = localStorage.getItem("templates");
          if (templatesRaw) {
             try {
               const templates = JSON.parse(templatesRaw);
               const tpl = templates.find((t: any) => t.id?.toString() === templateId);
               if (tpl?.category) cat = tpl.category.toUpperCase();
             } catch (e) {}
          }
        }

        let printSize: "4R" | "2R" = "4R";
        if (cat === "REGULER") printSize = "2R";
        else if (cat === "REGULER-NOSTRIP") printSize = "4R";
        else if (canvasType === "flipbook") printSize = "2R";
        
        setSelectedPrintSize(printSize);
        await handlePrint(false, 1, printSize, true);
      } else {
        setHasPrinted(true);
      }
    };
    
    if (finalImage) {
      doAutoPrint();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalImage, canvasType, templateId, templateCategory]);

  const handleMainPrintAction = (size: "4R" | "2R") => {
    setSelectedPrintSize(size);
    
    // Jika belum pernah cetak sama sekali dan milih 1 lembar -> Gratis
    if (!hasPrinted && printCopies === 1) {
        handlePrint(false, 1, size);
    } else {
        // Jika sudah pernah cetak, ATAU milih lebih dari 1 lembar -> Bayar
        // Bayar untuk jumlah lembar yang dipilih (dikurangi 1 jika belum pernah cetak)
        const unitPrice = amountPrintForCanvas(pricing, canvasType);
        const qtyToPay = hasPrinted ? printCopies : (printCopies - 1);
        
        if (qtyToPay > 0) {
            handleExtraPrintPayment(unitPrice * qtyToPay, printCopies, size);
        } else {
            // Fallback: This shouldn't normally happen if logic is correct
            handlePrint(false, 1, size);
        }
    }
  };

  const handleExtraPrintPayment = async (amount: number, totalQty: number, size: "4R" | "2R") => {
    setPendingPrintQty(totalQty);
    setPendingPrintAmount(amount);
    setSelectedPrintSize(size);
    setIsQrisModalOpen(true);
    setQrisState("loading");
    setQrisData(null);
    setTimeLeft(180); // 3 minutes is enough for extra print
    
    try {
      const response = await fetch('/api/generate-qris', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amount,
          canvas_type: canvasType,
          gateway_name: pricing?.name,
          server_key: pricing?.server_key,
          client_key: pricing?.client_key,
          is_production: pricing?.is_production === true,
        })
      });
      const result = await response.json();
      if (result.success) {
        setQrisData(result.data);
        setQrisState("ready");
      } else {
        setQrisState("error");
      }
    } catch (e) { setQrisState("error"); }
  };

  useEffect(() => {
    if (qrisState !== "ready" || !isQrisModalOpen) return;
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/check-status?order_id=${qrisData?.order_id}&server_key=${pricing?.server_key}&is_production=${pricing?.is_production ? "1" : "0"}`);
        const result = await response.json();
        if (result.success && result.data?.status === "paid") {
          setQrisState("success");
          clearInterval(interval);
          setTimeout(() => { 
            setIsQrisModalOpen(false); 
            // Cetak dengan quantity yang sudah dibayar
            handlePrint(true, pendingPrintQty, selectedPrintSize); 
          }, 2000);
        }
      } catch (e) { }
    }, 3000);
    return () => clearInterval(interval);
  }, [qrisState, isQrisModalOpen, qrisData, pricing]);

  useEffect(() => {
    if (previewMode === "gif" && rawPhotos.length > 0) {
      const interval = setInterval(() => {
        setCurrentGifIndex((prev) => (prev + 1) % rawPhotos.length);
      }, 500);
      return () => clearInterval(interval);
    }
  }, [previewMode, rawPhotos]);

  useEffect(() => {
    if (qrisState === "ready" && timeLeft > 0) {
      const timer = setInterval(() => setTimeLeft(p => p - 1), 1000);
      return () => clearInterval(timer);
    } else if (timeLeft === 0) setQrisState("error");
  }, [qrisState, timeLeft]);

  const handleNewSession = async () => {
    // Apabila user memaksa sesi baru saat upload masih berjalan/gagal, selamatkan tanpa duplikat!
    if (uploadStage !== "success" && uploadPromiseRef.current) {
      console.log("[Print] Membatalkan koneksi aktif untuk mengalihkan ke BackgroundUploader...");
      if (activeAbortControllerRef.current) activeAbortControllerRef.current.abort();
      if (activeXhrRef.current) activeXhrRef.current.abort();
      // Tunggu catch(e) di performUpload menyelesaikan tugas bungkus offline_queue
      await uploadPromiseRef.current;
    }

    // Hanya hapus data sesi, JANGAN hapus konfigurasi mesin (localStorage.clear())
    const sessionKeys = [
      "finalRenderImage",
      "rawPhotos",
      "capturedPhotos",
      "frameEdits",
      "templates",
      "templates_base_url",
      "stickers",
      "transactionDbId",
      "transactionId",
      "session_expiry",
      "order_id"
    ];
    
    sessionKeys.forEach(key => localStorage.removeItem(key));
    
    // Juga bersihkan localforage (video)
    localforage.removeItem("liveVideos");
    localforage.removeItem("finalLiveVideo");

    router.push("/");
  };

  // ── Auto Redirect ───────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      handleNewSession();
    }, 5 * 60 * 1000); // 5 menit
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!finalImage) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-[#f15a09]">
        <div className="w-16 h-16 border-8 border-white border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const downloadUrl = `https://potopi.site/downloads/${downloadToken}`;

  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#f15a09] font-sans text-slate-900 flex flex-col p-2 sm:p-3">
      
      <div className="relative flex-1 flex flex-col border-[4px] border-white rounded-[30px] overflow-hidden bg-[#f15a09] min-h-0">
        
        <header className="px-5 py-2 flex items-center justify-between shrink-0">
           <h1 className={`${mochiyPopOne.className} text-white text-base sm:text-lg uppercase tracking-widest drop-shadow-md`}>CETAK HASIL</h1>
           <div className="bg-white/20 px-4 py-1.5 rounded-full border border-white/40 text-white font-black text-xs sm:text-sm tracking-widest">
             READY FOR PRINT
           </div>
        </header>

        <main className="flex-1 flex flex-col gap-3 px-4 pb-3 min-h-0 overflow-hidden">

          <div className="flex-1 flex flex-row gap-4 min-h-0 overflow-hidden">

            <div className="flex-[1.65] flex flex-col min-h-0 min-w-0 gap-2">

              <h2 className={`${mochiyPopOne.className} text-white text-sm uppercase tracking-widest text-center shrink-0 drop-shadow-md`}>
                PREVIEW HASIL
              </h2>

          <div className="flex-1 min-h-0 bg-white rounded-[20px] shadow-2xl flex flex-col p-3 overflow-hidden border-3 border-white relative">
             <div className="flex-1 flex items-center justify-center overflow-hidden bg-slate-50 rounded-[1.5rem] relative shadow-inner min-h-0">
                 {previewMode === "photo" ? (
                    <img src={finalImage} alt="Final" className="h-full object-contain select-none animate-in fade-in duration-500" />
                 ) : previewMode === "gif" && rawPhotos.length > 0 ? (
                    <img src={rawPhotos[currentGifIndex]} alt="GIF Preview" className="h-full object-contain select-none" />
                 ) : finalVideoUrl ? (
                    <video src={finalVideoUrl} autoPlay loop muted className="h-full object-contain select-none animate-in fade-in duration-500" />
                 ) : (
                    <div className="flex flex-col items-center text-slate-300 gap-2">
                       <div className="w-10 h-10 border-4 border-slate-100 border-t-slate-300 rounded-full animate-spin"></div>
                       <span className="text-[10px] font-black uppercase tracking-widest">Memuat Video...</span>
                    </div>
                 )}
             </div>

             <div className="flex gap-2 mt-3 shrink-0 justify-center">
                <button 
                  onClick={() => setPreviewMode("photo")}
                  className={`px-5 py-2 rounded-full font-black text-[10px] uppercase tracking-widest transition-all ${previewMode === "photo" ? "bg-[#f15a09] text-white shadow-lg" : "bg-slate-100 text-slate-400"}`}
                >
                  PHOTO
                </button>
                <button 
                  onClick={() => setPreviewMode("gif")}
                  className={`px-5 py-2 rounded-full font-black text-[10px] uppercase tracking-widest transition-all ${previewMode === "gif" ? "bg-[#f15a09] text-white shadow-lg" : "bg-slate-100 text-slate-400"}`}
                >
                  GIF
                </button>
                <button 
                  onClick={() => setPreviewMode("live")}
                  className={`px-5 py-2 rounded-full font-black text-[10px] uppercase tracking-widest transition-all ${previewMode === "live" ? "bg-[#f15a09] text-white shadow-lg" : "bg-slate-100 text-slate-400"}`}
                >
                  LIVE
                </button>
             </div>
          </div>

            </div>



            <div className="flex-1 flex flex-col min-h-0 min-w-0 gap-2">

              <h2 className={`${mochiyPopOne.className} text-white text-sm uppercase tracking-widest text-center shrink-0 drop-shadow-md`}>
                UNDUH & CETAK
              </h2>

          <div className="flex-1 min-h-0 bg-white rounded-[20px] shadow-2xl flex flex-col items-center p-4 overflow-y-auto border-3 border-white">
             
             <div className="shrink-0 flex flex-col items-center text-center w-full max-w-[300px] mx-auto">
                 <h3 className={`${mochiyPopOne.className} text-slate-900 text-sm uppercase leading-relaxed mb-1`}>SCAN QR CODE</h3>
                 <h3 className={`${mochiyPopOne.className} text-[#f15a09] text-[10px] uppercase mb-4 tracking-tighter`}>DOWNLOAD SOFTFILE</h3>

                 <div className="p-5 bg-[#f15a09] rounded-[2rem] shadow-xl relative group mx-auto">
                    <div className="bg-white p-4 rounded-[1.2rem] shadow-inner flex items-center justify-center">
                       <QRCode value={downloadUrl} size={200} level="H" />
                    </div>
                {uploadStage !== "success" && (
                   <div className="absolute inset-0 bg-[#f15a09]/80 backdrop-blur-sm rounded-[3rem] flex items-center justify-center flex-col p-6">
                      {uploadStage === "error" ? (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="mb-3"><circle cx="12" cy="12" r="10"/><line x1="15" x2="9" y1="9" y2="15"/><line x1="9" x2="15" y1="9" y2="15"/></svg>
                          <span className="text-white text-[10px] font-black uppercase tracking-widest">UPLOAD GAGAL</span>
                        </>
                      ) : (
                        <>
                          <div className="relative w-16 h-16 mb-3">
                            <svg className="w-full h-full" viewBox="0 0 100 100">
                              <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="8" />
                              <circle cx="50" cy="50" r="42" fill="none" stroke="white" strokeWidth="8"
                                strokeDasharray={`${2 * Math.PI * 42}`}
                                strokeDashoffset={`${2 * Math.PI * 42 * (1 - uploadProgress / 100)}`}
                                strokeLinecap="round" transform="rotate(-90 50 50)" className="transition-all duration-300" />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="text-white text-sm font-black">{uploadProgress}%</span>
                            </div>
                          </div>
                          <span className="text-white text-[10px] font-black uppercase tracking-widest">MENGUNGGAH...</span>
                        </>
                      )}
                   </div>
                )}
             </div>

             </div>

             <div className="flex-1 flex flex-col items-center justify-center border-t-4 border-slate-50 pt-4 mt-4 gap-3 w-full max-w-[300px] mx-auto min-h-0">
                {/* Print Quantity Selector */}
                <div className="flex flex-col items-center mb-2 w-full">
                  <p className={`${mochiyPopOne.className} text-[10px] text-slate-400 mb-3 uppercase tracking-widest`}>JUMLAH CETAK</p>
                  <div className="flex items-center gap-6">
                    <button 
                      onClick={() => setPrintCopies(Math.max(1, printCopies - 1))}
                      disabled={isPrinting}
                      className="w-12 h-12 rounded-2xl bg-slate-50 border-2 border-slate-100 flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors disabled:opacity-50"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    </button>
                    <span className={`${mochiyPopOne.className} text-3xl text-slate-800 tabular-nums`}>{printCopies}</span>
                    <button 
                      onClick={() => setPrintCopies(Math.min(10, printCopies + 1))}
                      disabled={isPrinting}
                      className="w-12 h-12 rounded-2xl bg-[#f15a09]/10 border-2 border-[#f15a09]/20 flex items-center justify-center text-[#f15a09] hover:bg-[#f15a09]/20 transition-colors disabled:opacity-50"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    </button>
                  </div>
                  
                  {/* Total Price Display */}
                  <div className="mt-4 px-6 py-2 rounded-full bg-slate-50 border border-slate-100 flex items-center gap-2">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">ESTIMASI BIAYA:</span>
                    <span className="text-sm font-black text-[#f15a09]">
                      {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(
                        amountPrintForCanvas(pricing, canvasType) * (hasPrinted ? printCopies : Math.max(0, printCopies - 1))
                      )}
                    </span>
                  </div>
                </div>

                <div className="flex w-full justify-center">
                  <button 
                    onClick={() => {
                      const cat = templateCategory.toUpperCase();
                      let printSize: "4R" | "2R" = "4R";
                      if (cat === "REGULER") {
                        printSize = "2R";
                      } else if (cat === "REGULER-NOSTRIP") {
                        printSize = "4R";
                      } else if (canvasType === "flipbook") {
                        printSize = "2R";
                      } else {
                        printSize = "4R"; // default
                      }
                      handleMainPrintAction(printSize);
                    }}
                    disabled={isPrinting}
                    className={`flex-1 py-5 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl transition-all ${isPrinting ? 'bg-slate-100 text-slate-400' : 'bg-[#f15a09] text-white hover:scale-[1.03] active:scale-95'}`}
                  >
                    {isPrinting ? "..." : hasPrinted ? "TAMBAH CETAK" : "CETAK SEKARANG"}
                  </button>
                </div>
             </div>
          </div>

            </div>

          </div>

        </main>

        <footer className="shrink-0 flex items-center justify-center gap-4 py-3">
           <button
             onClick={handleNewSession}
             className="rounded-full bg-white px-10 py-2.5 text-sm font-black uppercase tracking-widest text-[#f15a09] shadow-2xl transition-transform hover:scale-[1.03] active:scale-[0.98]"
           >
             SESI BARU
           </button>
        </footer>

      </div>

      {/* QRIS Modal for Extra Print */}
      {isQrisModalOpen && (
        <QrisModal 
          basePrice={pendingPrintAmount} 
          gatewayName={pricing?.name || "QRIS"} 
          onClose={() => setIsQrisModalOpen(false)}
          qrisState={qrisState}
          qrisData={qrisData}
          timeLeft={timeLeft}
        />
      )}

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}

export default function PrintPage() {
  return (
    <Suspense fallback={<div className="h-screen w-full flex items-center justify-center bg-[#f15a09]"><div className="w-16 h-16 border-8 border-white border-t-transparent rounded-full animate-spin"></div></div>}>
      <PrintContent />
    </Suspense>
  );
}
