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

// ── Constants: 4R Paper at 300 DPI ─────────────────────────
// DNP (Landscape): 6x4 inches → 1800×1200 pixels
// Epson (Portrait): 4x6 inches → 1200×1800 pixels
function getPaperDimensions(orientation: string) {
  if (orientation === "portrait") {
    // Epson L18050 — portrait 4x6"
    const W = 1200;
    const H = 1800;
    return { PAPER_W: W, PAPER_H: H, HALF_H: H / 2, PAGE_W: W / 2, PAGE_H: H / 2 };
  }
  // DNP — landscape 6x4" (default)
  const W = 1800;
  const H = 1200;
  return { PAPER_W: W, PAPER_H: H, HALF_H: H / 2, PAGE_W: W / 2, PAGE_H: H / 2 };
}

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

function getFilterStyle(editState?: any): string {
  if (!editState) return "none";
  const b = 100 + (editState.brightness || 0);
  const c = 100 + (editState.contrast || 0);
  let extra = "";
  switch (editState.activeFilter) {
    case "bw": extra = " grayscale(100%)"; break;
    case "sepia": extra = " sepia(100%)"; break;
    case "vintage": extra = " sepia(50%) contrast(90%) brightness(110%) hue-rotate(-10deg)"; break;
    case "cinematic": extra = " contrast(120%) saturate(130%) brightness(95%)"; break;
    case "portrait": extra = " brightness(110%) saturate(110%) contrast(95%)"; break;
    case "vibrant": extra = " saturate(150%) contrast(110%)"; break;
    case "fade": extra = " contrast(85%) brightness(110%) saturate(80%)"; break;
    case "teal-orange": extra = " hue-rotate(-15deg) saturate(140%) contrast(110%)"; break;
    case "lomo": extra = " contrast(140%) saturate(130%) brightness(90%)"; break;
  }
  return `brightness(${b}%) contrast(${c}%)${extra}`;
}

// ── Upload Status Types ──────────────────────────────────
type UploadStage = "idle" | "uploading" | "success" | "error";
type PrintGenStage = "idle" | "extracting" | "compositing" | "done";

// ── QR Modal Component ──────────────────────────────────
function QrModal({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300">
      <div className="bg-white p-8 rounded-[2.5rem] shadow-2xl flex flex-col items-center w-full max-w-sm animate-in zoom-in-95 duration-500">
        <div className="flex items-center gap-2 text-orange-600 mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="5" height="5" x="3" y="3" rx="1" /><rect width="5" height="5" x="16" y="3" rx="1" /><rect width="5" height="5" x="3" y="16" rx="1" /><path d="M21 16h-3a2 2 0 0 0-2 2v3" /><path d="M21 21v.01" /><path d="M12 7v3a2 2 0 0 1-2 2H7" /><path d="M3 12h.01" /><path d="M12 3h.01" /><path d="M12 16v.01" /><path d="M16 12h1" /><path d="M21 12v.01" /><path d="M12 21v-1" /></svg>
          <span className="font-black tracking-widest text-sm uppercase">QR Download</span>
        </div>
        <div className="p-5 bg-slate-50 border-2 border-slate-100 rounded-3xl mb-6">
          <QRCode value={url} size={200} bgColor="transparent" fgColor="#1e293b" level="H" />
        </div>
        <p className="text-sm text-slate-500 font-medium text-center mb-6 px-4">
          Scan kode QR ini dengan ponsel Anda untuk mengunduh flipbook langsung ke galeri.
        </p>
        <button
          onClick={onClose}
          className="w-full py-3.5 rounded-full font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
        >
          TUTUP
        </button>
      </div>
    </div>
  );
}

// ── Print Success Modal ──────────────────────────────────
function PrintSuccessModal({ onClose, sheetCount }: { onClose: () => void; sheetCount: number }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300">
      <div className="bg-white p-10 rounded-[2.5rem] shadow-2xl flex flex-col items-center w-full max-w-sm animate-in zoom-in-95 duration-500">
        <div className="w-24 h-24 bg-emerald-100 text-emerald-500 rounded-full flex items-center justify-center border-4 border-white shadow-xl animate-bounce mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        </div>
        <h2 className="text-2xl font-black text-slate-800 mb-2">Sedang Mencetak!</h2>
        <p className="text-sm text-slate-500 font-medium text-center mb-3 px-4">
          Flipbook Anda sedang otomatis dicetak dari video.
        </p>
        <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-full px-4 py-2 mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-orange-500"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
          <span className="text-xs font-bold text-orange-700">{sheetCount} lembar kertas 4R</span>
        </div>
        <p className="text-xs text-slate-400 text-center mb-6 px-2">
          Setiap lembar 4R berisi 4 frame. Potong horizontal dan vertikal di garis pandu, susun sesuai nomor, lalu jilid.
        </p>
        <button
          onClick={onClose}
          className="w-full py-3.5 rounded-full font-bold text-white bg-linear-to-r from-orange-600 to-amber-600 hover:opacity-90 transition-all shadow-lg"
        >
          OKE
        </button>
      </div>
    </div>
  );
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
  qrisData: {
    qr_string?: string | null;
    qr_image_url?: string | null;
    order_id?: string;
    is_iframe?: boolean;
    is_snap?: boolean;
  } | null;
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
    <div className="fixed inset-0 z-100 flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300">
      {qrisState === "loading" && (
        <div className="flex flex-col items-center animate-in zoom-in-95 duration-500">
          <div className="w-24 h-24 bg-white rounded-4xl shadow-2xl flex items-center justify-center mb-6">
            <svg className="animate-spin text-orange-600" xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
          </div>
          <h2 className="text-2xl font-extrabold text-white">Membuat Barcode...</h2>
          <p className="text-white/60 font-medium text-sm mt-2">Menghubungkan ke perbankan</p>
        </div>
      )}

      {qrisState === "error" && (
        <div className="bg-white p-10 rounded-[2.5rem] shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 max-w-sm w-full">
          <div className="w-20 h-20 bg-rose-100 text-rose-600 rounded-4xl flex items-center justify-center mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" /></svg>
          </div>
          <h2 className="text-2xl font-extrabold text-slate-800 mb-2">{timeLeft <= 0 ? "Waktu Habis" : "Gagal Membuka QR"}</h2>
          <p className="text-slate-500 font-medium text-sm mb-8">Sistem pembayaran mengalami gangguan, silakan coba lagi nanti.</p>
          <button onClick={onClose} className="px-8 py-3.5 rounded-full font-bold text-white bg-slate-800 hover:bg-slate-700 w-full transition-colors">
            KEMBALI
          </button>
        </div>
      )}

      {(qrisState === "ready" || qrisState === "success") && (
        <div
          className={`relative flex w-full animate-in flex-col items-center overflow-hidden rounded-[3rem] bg-white p-8 pb-10 shadow-2xl duration-700 zoom-in-95 transition-all ${qrisData?.is_iframe ? "max-w-2xl" : "max-w-md"}`}
        >
          {!qrisData?.is_iframe && (
            <>
              <div className="mb-6 flex w-full items-center justify-center gap-2 text-orange-600">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="5" height="5" x="3" y="3" rx="1" /><rect width="5" height="5" x="16" y="3" rx="1" /><rect width="5" height="5" x="3" y="16" rx="1" /><path d="M21 16h-3a2 2 0 0 0-2 2v3" /><path d="M21 21v.01" /><path d="M12 7v3a2 2 0 0 1-2 2H7" /><path d="M3 12h.01" /><path d="M12 3h.01" /><path d="M12 16v.01" /><path d="M16 12h1" /><path d="M21 12v.01" /><path d="M12 21v-1" /></svg>
                <span className="text-sm font-black uppercase tracking-widest">{gatewayName}</span>
              </div>
              <div className="mb-6 flex flex-col items-center">
                <span className="text-4xl font-black text-slate-800">{formatPrice(basePrice)}</span>
              </div>
            </>
          )}
          <div
            className={`relative flex items-center justify-center rounded-3xl border-2 border-slate-100 bg-slate-50 shadow-sm transition-all duration-700 ${qrisData?.is_iframe ? "h-[min(72vh,560px)] w-full max-w-md p-0" : "h-64 w-64 p-4"} ${qrisState === "success" ? "absolute scale-0 opacity-0" : "scale-100 opacity-100"}`}
          >
            {qrisData?.is_iframe && qrisData?.qr_image_url ? (
              <iframe
                src={qrisData.qr_image_url}
                title="Pembayaran Midtrans Snap"
                className="h-full w-full rounded-2xl border-0 bg-white"
                sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              />
            ) : qrisData?.qr_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrisData.qr_image_url} alt="QRIS Payment" className="h-full w-full object-contain mix-blend-multiply" />
            ) : (
              <QRCode value={qrisData?.qr_string || "MOCK_QR"} size={200} bgColor={"transparent"} fgColor={"#1e293b"} level={"H"} />
            )}
          </div>
          <div className={`flex flex-col items-center absolute inset-0 bg-white/95 backdrop-blur z-10 justify-center transition-all duration-700 delay-300 ${qrisState === 'success' ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <div className="w-24 h-24 bg-emerald-100 text-emerald-500 rounded-full flex items-center justify-center border-4 border-white shadow-xl animate-bounce mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <h2 className="text-2xl font-black text-slate-800">Pembayaran Berhasil!</h2>
          </div>
          {qrisState !== "success" && (
            <div className="mt-8 flex flex-col items-center w-full">
              <div className="text-center mb-8 px-2">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-2">Sisa Waktu</p>
                <p className="text-2xl font-extrabold text-rose-500 leading-none tabular-nums">
                  {minutes.toString().padStart(2, '0')}:{seconds.toString().padStart(2, '0')}
                </p>
              </div>
              <button onClick={onClose} className="px-8 py-3 rounded-full font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 transition-colors w-full">
                BATAL & KEMBALI
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ── Print Sheet Preview Component ────────────────────────
function PrintSheetPreview({ sheets, currentSheet, onPrev, onNext }: {
  sheets: string[];
  currentSheet: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (sheets.length === 0) return null;
  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <div className="relative w-full rounded-3xl overflow-hidden shadow-xl border-2 border-slate-100 bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={sheets[currentSheet]}
          alt={`Print Sheet ${currentSheet + 1}`}
          className="w-full h-auto"
          draggable={false}
        />
        {/* Horizontal cut line indicator */}
        <div className="absolute top-1/2 left-0 right-0 -translate-y-1/2 flex items-center z-10">
          <div className="flex-1 border-t-2 border-dashed border-rose-400/60" />
          <span className="px-2 py-0.5 bg-rose-500 text-white text-[7px] font-black tracking-wider rounded-full shadow-sm uppercase">potong</span>
          <div className="flex-1 border-t-2 border-dashed border-rose-400/60" />
        </div>
        {/* Vertical cut line indicator */}
        <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 flex flex-col items-center z-10">
          <div className="flex-1 border-l-2 border-dashed border-rose-400/60" />
          <span className="px-0.5 py-2 bg-rose-500 text-white text-[7px] font-black tracking-wider rounded-full shadow-sm uppercase [writing-mode:vertical-lr] my-12">potong</span>
          <div className="flex-1 border-l-2 border-dashed border-rose-400/60" />
        </div>
      </div>
      <div className="flex items-center gap-4">
        <button
          onClick={onPrev}
          disabled={currentSheet === 0}
          className="p-2 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <span className="text-xs font-bold text-slate-500 tabular-nums">
          Lembar {currentSheet + 1} / {sheets.length}
        </span>
        <button
          onClick={onNext}
          disabled={currentSheet === sheets.length - 1}
          className="p-2 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
        </button>
      </div>
    </div>
  );
}


// ── Main Print Content ───────────────────────────────────
function FlipbookPrintContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const canvasType = searchParams.get("kanvas") || "flipbook";
  const templateId = searchParams.get("template") || "1";

  // Data States
  const [finalCover, setFinalCover] = useState<string | null>(null);
  const [pricing, setPricing] = useState<any>(null);
  const [downloadToken] = useState(() => generateToken());

  // Print Generation States
  const [printGenStage, setPrintGenStage] = useState<PrintGenStage>("idle");
  const [printSheets, setPrintSheets] = useState<string[]>([]);
  const [printProgress, setPrintProgress] = useState(0);
  const [currentPreviewSheet, setCurrentPreviewSheet] = useState(0);
  const [totalFrameCount, setTotalFrameCount] = useState(0);
  const printGenStarted = useRef(false);

  // Upload States (background)
  const [uploadStage, setUploadStage] = useState<UploadStage>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [finalImageDbId, setFinalImageDbId] = useState<number | null>(null);
  const uploadStarted = useRef(false);
  const uploadPromiseRef = useRef<Promise<number | null> | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  // UI States
  const [showQrModal, setShowQrModal] = useState(false);
  const [showPrintSuccess, setShowPrintSuccess] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [hasPrinted, setHasPrinted] = useState(false);
  const [selectedPrintSize] = useState<"4R" | "2R">("2R");
  const [printCopies, setPrintCopies] = useState(1);

  // ── Extra Print States ──────────────────────────────────
  const [isQrisModalOpen, setIsQrisModalOpen] = useState(false);
  const [qrisState, setQrisState] = useState<"loading" | "ready" | "success" | "error">("loading");
  const [qrisData, setQrisData] = useState<any>(null);
  const [pendingPrintQty, setPendingPrintQty] = useState(1);
  const [pendingPrintAmount, setPendingPrintAmount] = useState(0);
  useEffect(() => {
    localStorage.removeItem("session_expiry");
  }, []);

  const [timeLeft, setTimeLeft] = useState(300); // QRIS specific timer

  // ── Load Data from localStorage ────────────────────────
  useEffect(() => {
    const coverData = localStorage.getItem("flipbook_final_cover");
    const pricingRaw = localStorage.getItem("paymentGateway");

    if (!coverData) {
      router.push("/");
      return;
    }

    setFinalCover(coverData);
    if (pricingRaw) {
      try {
        const parsed = JSON.parse(pricingRaw);
        // Handle nested "data" property if present
        setPricing(parsed.data || parsed);
      } catch (e) { /* ignore */ }
    }
  }, [router]);

  // ── Generate Print Sheets from Video ─────────────────────
  const generatePrintSheets = useCallback(async () => {
    if (printGenStarted.current) return;
    printGenStarted.current = true;

    try {
      setPrintGenStage("compositing");
      setPrintProgress(10);

      // Load all processed & edited frames from storage (already contains photo + template + doodle/sticker)
      // Array size should be 40: [Cover, F1, F2, ..., F39]
      const allFrames: string[] = await localforage.getItem<string[]>("flipbook_final_frames") || [];

      if (allFrames.length < 40) {
        console.warn("Insufficient frames for printing. Expected 40, got:", allFrames.length);
      }

      // Pre-validate: ensure we have actual frame data, fill gaps with nearest good frame
      const validatedFrames: string[] = [];
      let lastGoodFrame: string | null = null;
      for (let i = 0; i < allFrames.length; i++) {
        const frame = allFrames[i];
        if (frame && frame.length > 100) {
          validatedFrames.push(frame);
          lastGoodFrame = frame;
        } else if (lastGoodFrame) {
          console.warn(`[FlipbookPrint] Frame ${i} is empty/corrupt, using last good frame as fallback.`);
          validatedFrames.push(lastGoodFrame);
        } else {
          // No good frame yet — push empty string, will be handled in drawFrame
          validatedFrames.push("");
        }
      }

      const sheets: string[] = [];
      const TOTAL_SHEETS = 10;

      // Baca orientasi printer dari localStorage
      const printerOrientation = localStorage.getItem("printerOrientation") || "landscape";
      const isPortraitMode = printerOrientation === "portrait";
      const dim = getPaperDimensions(printerOrientation);
      console.log(`[FlipbookPrint] Orientasi printer: ${printerOrientation}, Dimensi kertas: ${dim.PAPER_W}x${dim.PAPER_H}, Page: ${dim.PAGE_W}x${dim.PAGE_H}`);

      // Rules for 10 sheets (4 pages per sheet):
      // LEMBAR 1: [COVER | F10] (top) + [F1 | F11] (bottom)
      // LEMBAR 2: [F2 | F12] (top) + [F3 | F13] (bottom)
      // etc.

      // Helper: load image with error handling and fallback
      let sheetLastGoodImg: HTMLImageElement | null = null;

      for (let s = 0; s < TOTAL_SHEETS; s++) {
        const sheetCanvas = document.createElement("canvas");
        sheetCanvas.width = dim.PAPER_W;
        sheetCanvas.height = dim.PAPER_H;
        const ctx = sheetCanvas.getContext("2d")!;

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, dim.PAPER_W, dim.PAPER_H);

        // Helper to draw a single image into a slot, with rotation for portrait mode
        const drawImageToSlot = (img: HTMLImageElement, x: number, y: number) => {
          if (isPortraitMode) {
            // Frame asli landscape → putar 90° CW agar tegak di slot portrait
            // Slot: (x, y) dengan ukuran PAGE_W × PAGE_H (600×900)
            ctx.save();
            ctx.translate(x + dim.PAGE_W, y); // pindah ke pojok kanan-atas slot
            ctx.rotate(Math.PI / 2);           // putar 90° CW
            // Setelah rotasi: sumbu X mengarah ke bawah, sumbu Y mengarah ke kiri
            // Gambar dengan width=PAGE_H(900), height=PAGE_W(600) di koordinat rotasi
            // Ini mengisi slot 600×900 di layar
            ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, dim.PAGE_H, dim.PAGE_W);
            ctx.restore();
          } else {
            // DNP landscape — gambar langsung tanpa rotasi
            ctx.drawImage(img, 0, 0, img.width, img.height, x, y, dim.PAGE_W, dim.PAGE_H);
          }
        };

        // Helper to load and draw a frame into a specific slot
        const drawFrame = async (frameIdx: number, x: number, y: number) => {
          if (frameIdx >= validatedFrames.length || !validatedFrames[frameIdx] || validatedFrames[frameIdx].length < 100) {
            if (sheetLastGoodImg && sheetLastGoodImg.naturalWidth > 0) {
              console.warn(`[FlipbookPrint] Frame ${frameIdx} missing, using fallback on sheet ${s}`);
              drawImageToSlot(sheetLastGoodImg, x, y);
            }
            return;
          }
          const img = await new Promise<HTMLImageElement>((resolve) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => {
              console.warn(`[FlipbookPrint] Failed to load frame ${frameIdx} for sheet ${s}`);
              resolve(i);
            };
            i.src = validatedFrames[frameIdx]!;
            setTimeout(() => resolve(i), 3000);
          });
          
          if (img.naturalWidth > 0) {
            drawImageToSlot(img, x, y);
            sheetLastGoodImg = img;
          } else if (sheetLastGoodImg && sheetLastGoodImg.naturalWidth > 0) {
            console.warn(`[FlipbookPrint] Frame ${frameIdx} failed to decode, using fallback`);
            drawImageToSlot(sheetLastGoodImg, x, y);
          }
        };

        let fTopLeft = s * 2;
        let fTopRight = 20 + (s * 2);
        let fBottomLeft = s * 2 + 1;
        let fBottomRight = 20 + (s * 2) + 1;

        await drawFrame(fTopLeft, 0, 0);
        await drawFrame(fTopRight, dim.PAGE_W, 0);
        await drawFrame(fBottomLeft, 0, dim.HALF_H);
        await drawFrame(fBottomRight, dim.PAGE_W, dim.HALF_H);

        // Draw cut guides
        ctx.strokeStyle = "rgba(0,0,0,0.1)";
        ctx.setLineDash([10, 10]);
        ctx.beginPath();
        ctx.moveTo(0, dim.HALF_H); ctx.lineTo(dim.PAPER_W, dim.HALF_H); // horizontal cut
        ctx.moveTo(dim.PAGE_W, 0); ctx.lineTo(dim.PAGE_W, dim.PAPER_H); // vertical cut
        ctx.stroke();

        sheets.push(sheetCanvas.toDataURL("image/jpeg", 0.98));
        setPrintProgress(10 + Math.round(((s + 1) / TOTAL_SHEETS) * 90));
      }

      setPrintSheets(sheets);
      await localforage.setItem("flipbook_print_sheets", sheets);
      setPrintGenStage("done");
      setPrintProgress(100);

    } catch (err) {
      console.error("Print generation error:", err);
      setPrintGenStage("done");
    }
  }, []);

  // Start generating print sheets when cover is loaded
  useEffect(() => {
    if (finalCover && !printGenStarted.current) {
      const timer = setTimeout(() => generatePrintSheets(), 300);
      return () => clearTimeout(timer);
    }
  }, [finalCover, generatePrintSheets]);


  // ── Helper: Save All Files Locally ─────
  const saveAllFilesLocally = async () => {
    try {
      const storedFinal = localStorage.getItem("flipbook_final_cover");
      const storedTx = localStorage.getItem("transactionDbId");
      if (!storedFinal || !storedTx) return;

      const flipbookFrames = await localforage.getItem<string[]>("flipbook_final_frames") || [];

      const payload: any = {
        transaction_id: storedTx,
        template_id: templateId,
        finalImageBase64: storedFinal,
        rawPhotos: flipbookFrames,
      };

      // Convert video blob to base64 for the API
      const videoBlob = await localforage.getItem<Blob>("flipbook_video");
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
          console.warn('[FlipbookPrint] Gagal mengkonversi video ke base64 untuk backup lokal:', vidErr);
        }
      }

      await fetch('/api/save-failed-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      console.log(`[FlipbookPrint] Semua file backup lokal disimpan untuk transaksi: ${storedTx}`);
    } catch (err) {
      console.error('[FlipbookPrint] Gagal menyimpan backup lokal lengkap:', err);
    }
  };

  const handleOfflineFallback = async () => {
    try {
      const storedFinalCover = localStorage.getItem("flipbook_final_cover");
      const storedTxDbId = localStorage.getItem("transactionDbId");
      if (!storedFinalCover || !storedTxDbId) return;

      const flipbookFrames = await localforage.getItem<string[]>("flipbook_final_frames") || [];

      const payloadPhotos = flipbookFrames.map((photo: string, index: number) => {
         return { imageBase64: photo, frame_id: index.toString() }
      }).filter((p: any) => p.imageBase64 && p.imageBase64.length > 100);

      const finalVideoBlob = await localforage.getItem<Blob>("flipbook_video");

      const queueId = "offline_upload_" + Date.now() + "_" + Math.floor(Math.random()*1000);
      const queueData = {
        id: queueId,
        transaction_id: storedTxDbId,
        template_id: templateId,
        token_final_image: downloadToken,
        finalImageBase64: storedFinalCover,
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
      console.log("[FlipbookPrint] Disimpan ke Offline Upload Queue:", queueId);

      // Langsung simpan semua file ke komputer lokal (tidak mengganggu antrian jika gagal)
      try {
        await saveAllFilesLocally();
      } catch (localSaveErr) {
        console.error('[FlipbookPrint] Backup lokal gagal, tapi antrian tetap aman:', localSaveErr);
      }
    } catch(err) {
      console.error("[FlipbookPrint] Gagal nge-save Offline Queue", err);
    }
  };

  // ── Background Upload (fire-and-forget) ────────────────
  const performUpload = useCallback(async () => {
    if (uploadStarted.current) return uploadPromiseRef.current;
    uploadStarted.current = true;

    const uploadTask = (async () => {
      try {
        const storedFinalCover = localStorage.getItem("flipbook_final_cover");
        if (!storedFinalCover) return null;

        // Ambil transaction ID
        const storedTxDbId = localStorage.getItem("transactionDbId");
        if (!storedTxDbId) {
          console.error("No transaction ID found in localStorage.");
          setUploadError("Transaksi tidak ditemukan.");
          setUploadStage("error");
          return null;
        }
        const dbTxId = parseInt(storedTxDbId);

        setUploadStage("uploading");
        setUploadProgress(0);
        const formData = new FormData();
        formData.append("transaction_id", dbTxId.toString());
        formData.append("template_id", templateId);
        formData.append("token_final_image", downloadToken);

        // Upload edit cover
        const coverBlob = dataUrlToBlob(storedFinalCover);
        formData.append("image", coverBlob, "flipbook_cover.jpg");

        // Upload Video (converted to MP4 for iOS/Android compatibility)
        try {
          const videoBlob = await localforage.getItem<Blob>("flipbook_video");
          if (videoBlob) {
            let videoToUpload: Blob = videoBlob;
            
            // Convert WebM → MP4 if the video is in WebM format
            if (videoBlob.type.includes("webm") || !videoBlob.type.includes("mp4")) {
              try {
                const convertForm = new FormData();
                convertForm.append("video", videoBlob, "input.webm");
                const convertRes = await fetch("/api/convert-video", {
                  method: "POST",
                  body: convertForm,
                });
                if (convertRes.ok && convertRes.headers.get("X-Conversion-Success") === "true") {
                  const mp4ArrayBuffer = await convertRes.arrayBuffer();
                  videoToUpload = new Blob([mp4ArrayBuffer], { type: "video/mp4" });
                  console.log("[FlipbookPrint] Video converted WebM → MP4 successfully:", videoToUpload.size, "bytes");
                } else {
                  console.warn("[FlipbookPrint] Video conversion failed, uploading original WebM with MP4 wrapper");
                  videoToUpload = new Blob([videoBlob], { type: "video/mp4" });
                }
              } catch (convErr) {
                console.warn("[FlipbookPrint] Video conversion error, uploading original:", convErr);
                videoToUpload = new Blob([videoBlob], { type: "video/mp4" });
              }
            }
            
            formData.append("video", videoToUpload, "flipbook_video.mp4");
          }
        } catch (e) {
          console.warn("Error fetching flipbook video from localforage", e);
        }

        // Use XMLHttpRequest for upload progress tracking
        const data = await new Promise<any>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/final-images");
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              setUploadProgress(Math.round((e.loaded / e.total) * 100));
            }
          };
          xhr.onload = () => {
            try { resolve(JSON.parse(xhr.responseText)); }
            catch { reject(new Error("Invalid response")); }
          };
          xhr.onerror = () => reject(new Error("Upload failed"));
          xhr.send(formData);
        });

        if (!data.success) {
          console.error("Flipbook upload failed:", data);
          setUploadError(data.message || "Gagal mengunggah foto/video flipbook");
          setUploadStage("error");
          await handleOfflineFallback();
          return null;
        }

        const id = data.data.id;
        setFinalImageDbId(id);
        setUploadStage("success");
        setUploadProgress(100);

        // Tetap simpan backup lokal lengkap walaupun upload berhasil (tidak mengganggu alur utama)
        try {
          await saveAllFilesLocally();
        } catch (localErr) {
          console.error('[FlipbookPrint] Backup lokal gagal setelah upload berhasil (tidak masalah):', localErr);
        }

        // Bersihkan memori berat
        localStorage.removeItem("flipbook_cover");
        localStorage.removeItem("flipbook_frames");
        localforage.removeItem("flipbook_video");
        localforage.removeItem("flipbook_final_frames");

        return id;
      } catch (error) {
        console.error("Upload error:", error);
        setUploadError("Terjadi kesalahan sistem saat unggah.");
        setUploadStage("error");
        await handleOfflineFallback();
        return null;
      }
    })();

    uploadPromiseRef.current = uploadTask;
    return uploadTask;
  }, [templateId, downloadToken]);

  useEffect(() => {
    if (finalCover && !uploadStarted.current) {
      const timer = setTimeout(() => performUpload(), 300);
      return () => clearTimeout(timer);
    }
  }, [finalCover, performUpload]);

  // ── Retry Upload ─────────────────────────────────────
  const retryUpload = () => {
    uploadStarted.current = false;
    uploadPromiseRef.current = null;
    setUploadStage("idle");
    setUploadError(null);
    setTimeout(() => performUpload(), 300);
  };

  // ── Extra Print Payment Logic ───────────────────────
  const handleGenerateExtraPrintQris = async (amount: number, totalQty: number) => {
    setPendingPrintQty(totalQty);
    setPendingPrintAmount(amount);
    setIsQrisModalOpen(true);
    setQrisState("loading");
    setQrisData(null);
    setTimeLeft(300);

    try {
      const response = await fetch('/api/generate-qris', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amount,
          canvas_type: canvasType,
          gateway_name: pricing.name,
          server_key: pricing.server_key,
          client_key: pricing.client_key,
          is_production: pricing.is_production === true,
        })
      });
      const result = await response.json();

      if (
        result.success &&
        result.data?.order_id &&
        (Boolean(result.data.qr_string) ||
          result.data.is_snap === true ||
          Boolean(result.data.qr_image_url))
      ) {
        setQrisData(result.data);
        setQrisState("ready");
      } else {
        setQrisState("error");
      }
    } catch (error) {
      console.error("Error generating QRIS:", error);
      setQrisState("error");
    }
  };

  const handleMainPrintAction = () => {
    if (!hasPrinted && printCopies === 1) {
      handlePrint(false); // Free first print
    } else {
      const unitPrice = pricing ? pricing[`amount_print_${canvasType}`] || 0 : 0;
      const qtyToPay = hasPrinted ? printCopies : (printCopies - 1);
      
      if (qtyToPay > 0) {
        handleGenerateExtraPrintQris(unitPrice * qtyToPay, printCopies);
      } else {
        handlePrint(false);
      }
    }
  };

  // Poll for status
  useEffect(() => {
    if (qrisState !== "ready" || !qrisData?.order_id || !pricing?.server_key || !isQrisModalOpen) return;

    const interval = setInterval(async () => {
      try {
        const response = await fetch(
          `/api/check-status?order_id=${encodeURIComponent(qrisData.order_id)}&server_key=${encodeURIComponent(pricing.server_key!)}&is_production=${pricing.is_production === true ? "1" : "0"}`,
        );
        const result = await response.json();

        if (result.success && result.data?.status === "paid") {
          setQrisState("success");
          clearInterval(interval);

          // Create transaction record
          const extraPrice = pendingPrintAmount;
          await fetch("/api/transactions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              transaction_id: qrisData.order_id,
              amount: extraPrice,
              payment_type: "qris",
              status: "PAID",
            }),
          });

          setTimeout(() => {
            setIsQrisModalOpen(false);
            // Gunakan quantity yang dipending saat generate QRIS
            handlePrint(true, pendingPrintQty);
          }, 2000);
        }
      } catch (e) {
        console.error("Poll error:", e);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [qrisState, qrisData, pricing, isQrisModalOpen, canvasType]);

  // Countdown
  useEffect(() => {
    if (qrisState !== "ready" || !isQrisModalOpen) return;
    if (timeLeft <= 0) {
      setQrisState("error");
      return;
    }
    const timer = setInterval(() => setTimeLeft((prev) => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [qrisState, timeLeft, isQrisModalOpen]);

  // ── Print Handler ──────────────────────────────────────
  const handlePrint = async (isExtra = false, customQty?: number, isAutoPrint = false) => {
    if (isPrinting) return;
    if (hasPrinted && !isExtra) return;

    const printSize = selectedPrintSize;
    const standardPrinter = localStorage.getItem("preferredPrinterName") || "DNP DS-RX1";
    const splitPrinter = localStorage.getItem("preferredPrinterSplitName") || "";

    // Flipbook logic: 
    // 4R (Standard) -> uses preferredPrinterName
    // 2R (Split) -> uses preferredPrinterSplitName or fallback to auto-append ' split'
    let targetPrinter = standardPrinter;
    if (printSize === "2R") {
      targetPrinter = splitPrinter || (standardPrinter.toLowerCase().includes("split")
        ? standardPrinter
        : `${standardPrinter} split`);
    }

    setIsPrinting(true);

    (async () => {
      try {
        let dbId = finalImageDbId;
        if (!dbId && uploadPromiseRef.current) {
          dbId = await Promise.race([
            uploadPromiseRef.current,
            new Promise<null>(r => setTimeout(() => r(null), 500))
          ]);
        }

        const rawPrintPrice = pricing ? pricing[`amount_print_${canvasType}`] || 0 : 0;
        const finalPrintPrice = isExtra ? Math.round(Number(rawPrintPrice)) : 0;
        const targetQty = customQty || printCopies;

        const orientation = localStorage.getItem("printerOrientation") || "landscape";

        const response = await fetch(`/api/final-images/${dbId || 0}/print`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount_print: finalPrintPrice,
            print_quantity: isExtra ? targetQty : 1,
            printer_name: targetPrinter,
            printer_orientation: orientation,
            images_data: await localforage.getItem("flipbook_print_sheets"),
            copies: isExtra ? targetQty : 1
          }),
        });
        const data = await response.json();
        console.log("[Flipbook Print Response]", data);
        if (response.ok && data.success !== false) {
          if (!isExtra) setHasPrinted(true);
          if (!isAutoPrint) setShowPrintSuccess(true);
        } else {
          if (!isAutoPrint) alert("GAGAL MENCETAK: " + (data.message || "Pastikan printer terhubung dan online."));
        }
      } catch (error) {
        if (!isAutoPrint) alert("Terjadi kesalahan jaringan saat mencoba mencetak.");
        console.error("Print error:", error);
      } finally {
        setIsPrinting(false);
      }
    })();
  };

  useEffect(() => {
    const doAutoPrint = async () => {
      const storedTxId = localStorage.getItem("transactionDbId");
      if (!storedTxId) return;

      const autoPrintedKey = `auto_printed_${storedTxId}`;
      if (!localStorage.getItem(autoPrintedKey)) {
        localStorage.setItem(autoPrintedKey, "1");
        await handlePrint(false, 1, true); // true for isAutoPrint
      } else {
        setHasPrinted(true);
      }
    };

    if (printGenStage === "done" && printSheets.length > 0) {
      doAutoPrint();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printGenStage, printSheets.length]);

  // ── New Session Handler ──────────────────────────────
  const handleNewSession = () => {
    localStorage.removeItem("flipbook_final_cover");
    localStorage.removeItem("flipbook_coverEdit");
    localStorage.removeItem("templates");
    localStorage.removeItem("templates_base_url");
    localStorage.removeItem("stickers");
    localStorage.removeItem("transactionDbId");
    localStorage.removeItem("transactionId");
    localforage.removeItem("flipbook_print_sheets");
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

  // ── QR Download URL ──────────────────────────────────
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://potopi.site";
  const downloadUrl = `${baseUrl.replace(/\/$/, '')}/downloads/${downloadToken}`;

  const isUploadInProgress = uploadStage === "idle" || uploadStage === "uploading";
  const isUploadDone = uploadStage === "success";
  const isUploadFailed = uploadStage === "error";
  const isPrintSheetsReady = printGenStage === "done" && printSheets.length > 0;

  if (!finalCover) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-[#f15a09]">
        <div className="w-16 h-16 border-8 border-white border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#f15a09] font-sans text-slate-900 flex flex-col p-2 sm:p-3">

      <div className="relative flex-1 flex flex-col border-[4px] border-white rounded-[30px] overflow-hidden bg-[#f15a09] min-h-0">

        <header className="px-5 py-2 flex items-center justify-between shrink-0">
          <h1 className={`${mochiyPopOne.className} text-white text-base sm:text-lg uppercase tracking-widest drop-shadow-md`}>CETAK FLIPBOOK</h1>
          <div className="flex items-center gap-3">
            {printGenStage !== "idle" && printGenStage !== "done" && (
              <div className="flex items-center gap-2 bg-white/20 px-5 py-2 rounded-full border border-white/40 text-white">
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span className="font-black text-[10px] tracking-widest uppercase">MENYUSUN {printProgress}%</span>
              </div>
            )}
            {isPrintSheetsReady && (
              <div className="bg-white/20 px-4 py-1.5 rounded-full border border-white/40 text-white font-black text-xs sm:text-sm tracking-widest">
                {printSheets.length} LEMBAR SIAP
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 flex flex-col gap-3 px-4 pb-3 min-h-0 overflow-hidden items-stretch">

          <div className="flex-1 flex flex-row gap-4 min-h-0 overflow-hidden">

            <div className="flex-[1.65] flex flex-col min-h-0 min-w-0 gap-2">

              <h2 className={`${mochiyPopOne.className} text-white text-sm uppercase tracking-widest text-center shrink-0 drop-shadow-md`}>
                PREVIEW CETAK
              </h2>

          <div className="flex-1 min-h-0 bg-white rounded-[20px] shadow-2xl flex flex-col p-3 overflow-hidden border-3 border-white relative">
            <div className="flex-1 flex items-center justify-center overflow-hidden bg-slate-50 rounded-[1.5rem] relative shadow-inner min-h-0">
              {isPrintSheetsReady ? (
                <div className="w-full h-full flex flex-col items-center justify-center p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={printSheets[currentPreviewSheet]}
                    alt={`Lembar ${currentPreviewSheet + 1}`}
                    className="max-h-full max-w-full object-contain select-none animate-in fade-in duration-500"
                    draggable={false}
                  />
                  <div className="absolute top-1/2 left-[10%] right-[10%] -translate-y-1/2 flex items-center z-10 pointer-events-none">
                    <div className="flex-1 border-t-2 border-dashed border-rose-400/40" />
                    <span className="px-2 py-0.5 bg-rose-500/60 text-white text-[7px] font-black tracking-wider rounded-full uppercase">potong</span>
                    <div className="flex-1 border-t-2 border-dashed border-rose-400/40" />
                  </div>
                  <div className="absolute top-[10%] bottom-[10%] left-1/2 -translate-x-1/2 flex flex-col items-center z-10 pointer-events-none">
                    <div className="flex-1 border-l-2 border-dashed border-rose-400/40" />
                    <div className="flex-1 border-l-2 border-dashed border-rose-400/40" />
                  </div>
                </div>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={finalCover} alt="Final Cover" className="h-full object-contain select-none animate-in fade-in duration-500" draggable={false} />
              )}
            </div>

            {isPrintSheetsReady ? (
              <div className="flex gap-3 mt-3 shrink-0 justify-center items-center">
                <button
                  onClick={() => setCurrentPreviewSheet(p => Math.max(0, p - 1))}
                  disabled={currentPreviewSheet === 0}
                  className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center disabled:opacity-30 hover:bg-slate-200 transition-all"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
                </button>
                <span className="text-xs font-black text-slate-400 tabular-nums tracking-widest uppercase">
                  Lembar {currentPreviewSheet + 1} / {printSheets.length}
                </span>
                <button
                  onClick={() => setCurrentPreviewSheet(p => Math.min(printSheets.length - 1, p + 1))}
                  disabled={currentPreviewSheet === printSheets.length - 1}
                  className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center disabled:opacity-30 hover:bg-slate-200 transition-all"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                </button>
              </div>
            ) : (
              <div className="flex gap-3 mt-3 shrink-0 justify-center">
                <span className="px-5 py-2 rounded-full bg-[#f15a09] text-white font-black text-[10px] uppercase tracking-widest">COVER FLIPBOOK</span>
              </div>
            )}

            {printGenStage !== "idle" && printGenStage !== "done" && (
              <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center rounded-[40px] z-20">
                <div className="relative mb-4">
                  <svg className="w-20 h-20" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="40" fill="none" stroke="#f1f5f9" strokeWidth="6" />
                    <circle cx="50" cy="50" r="40" fill="none" stroke="#f15a09" strokeWidth="6"
                      strokeDasharray={`${2 * Math.PI * 40}`}
                      strokeDashoffset={`${2 * Math.PI * 40 * (1 - printProgress / 100)}`}
                      strokeLinecap="round" transform="rotate(-90 50 50)" className="transition-all duration-300" />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xl font-black text-[#f15a09]">{printProgress}%</span>
                  </div>
                </div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Menyusun Layout Cetak...</p>
              </div>
            )}
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
                {isPrintSheetsReady && (
                  <div className="grid grid-cols-2 gap-3 mb-2 w-full shrink-0">
                    <div className="bg-orange-50 rounded-2xl p-3 text-center border-2 border-orange-100">
                  <p className="text-2xl font-black text-[#f15a09]">40</p>
                  <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Halaman</p>
                </div>
                <div className="bg-orange-50 rounded-2xl p-3 text-center border-2 border-orange-100">
                  <p className="text-2xl font-black text-[#f15a09]">{printSheets.length}</p>
                  <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Lembar 4R</p>
                </div>
              </div>
            )}

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
                    (pricing ? pricing[`amount_print_${canvasType}`] || 0 : 0) * (hasPrinted ? printCopies : Math.max(0, printCopies - 1))
                  )}
                </span>
              </div>
            </div>

            <div className="flex w-full justify-center">
              <button
                onClick={handleMainPrintAction}
                disabled={isPrinting || !isPrintSheetsReady}
                className={`w-full py-5 rounded-full font-black text-sm uppercase tracking-widest shadow-xl transition-all ${isPrinting ? 'bg-slate-100 text-slate-400' : 'bg-[#f15a09] text-white hover:scale-[1.03] active:scale-95'}`}
              >
                {isPrinting ? "MENCETAK..." : hasPrinted ? "TAMBAH CETAK" : "CETAK SEKARANG"}
              </button>
            </div>
            </div>
          </div>

            </div>

          </div>

        </main>

        <footer className="shrink-0 flex items-center justify-center gap-3 py-3 flex-wrap">
          {isUploadFailed && (
            <button
              onClick={retryUpload}
              className="rounded-full border-2 border-white px-6 py-2.5 text-xs font-black uppercase tracking-widest text-white transition-colors hover:bg-white/10"
            >
              UPLOAD GAGAL — COBA LAGI
            </button>
          )}
          <button
            onClick={handleNewSession}
            className="rounded-full bg-white px-10 py-2.5 text-sm font-black uppercase tracking-widest text-[#f15a09] shadow-2xl transition-transform hover:scale-[1.03] active:scale-[0.98]"
          >
            SESI BARU
          </button>
        </footer>

      </div>

      {/* Modals */}
      {showQrModal && <QrModal url={downloadUrl} onClose={() => setShowQrModal(false)} />}
      {showPrintSuccess && (
        <PrintSuccessModal
          onClose={() => setShowPrintSuccess(false)}
          sheetCount={printSheets.length}
        />
      )}
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
    </div>
  );
}

export default function FlipbookPrintPage() {
  return (
    <Suspense fallback={
      <div className="h-screen w-full flex items-center justify-center bg-[#f15a09]">
        <div className="w-16 h-16 border-8 border-white border-t-transparent rounded-full animate-spin"></div>
      </div>
    }>
      <FlipbookPrintContent />
    </Suspense>
  );
}
