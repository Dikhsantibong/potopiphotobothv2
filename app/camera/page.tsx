"use client";



import React, { useState, useEffect, useRef, useCallback, Suspense } from "react";

import { useRouter, useSearchParams } from "next/navigation";

import localforage from "localforage";

import { Mochiy_Pop_One } from "next/font/google";

import { useCamera } from "../hooks/useCamera";



const mochiyPopOne = Mochiy_Pop_One({

  subsets: ["latin"],

  weight: "400",

});



interface TemplateFrame {

  x: number;

  y: number;

  width: number;

  height: number;

}



interface TemplateItem {

  id: number;

  name: string;

  template_path: string;

  image_width: number;

  image_height: number;

  frame_count: number;

  frames?: TemplateFrame[];

}



function CameraContent() {

  const router = useRouter();

  const searchParams = useSearchParams();

  const canvasType = searchParams.get("kanvas") || "koran";

  const templateId = searchParams.get("template") || "1";

  const totalFrames = Number(searchParams.get("frames")) || 4;



  // Template Data

  const [template, setTemplate] = useState<TemplateItem | null>(null);

  const [baseUrl, setBaseUrl] = useState("");



  // Camera & Photo States

  const videoRef = useRef<HTMLVideoElement>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const streamRef = useRef<MediaStream | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const videoChunksRef = useRef<BlobPart[]>([]);



  const [currentFrame, setCurrentFrame] = useState(0);

  const [photos, setPhotos] = useState<(string | null)[]>(Array(totalFrames).fill(null));

  const [videos, setVideos] = useState<(Blob | null)[]>(Array(totalFrames).fill(null));

  const recorderRef = useRef<MediaRecorder | null>(null);

  const chunksRef = useRef<Blob[]>([]);

  const currentFrameRef = useRef(0);

  const [cameraReady, setCameraReady] = useState(false);

  const [countdown, setCountdown] = useState<number | null>(null);

  const [isMirrored, setIsMirrored] = useState(true);



  useEffect(() => {

    currentFrameRef.current = currentFrame;

  }, [currentFrame]);

  const [flashActive, setFlashActive] = useState(false);

  const [showPreview, setShowPreview] = useState(false);

  const [showBackConfirm, setShowBackConfirm] = useState(false);



  const [frameEdits, setFrameEdits] = useState<Record<number, any>>({});

  const currentEdit = frameEdits[currentFrame] || { brightness: 0, contrast: 0, activeFilter: "normal" };



  // Timer States

  const [timeLeft, setTimeLeft] = useState(300);

  useEffect(() => {

    const savedTimeout = localStorage.getItem("sessionTimeout");

    if (savedTimeout) setTimeLeft(parseInt(savedTimeout, 10));

  }, []);

  const [showWarning, setShowWarning] = useState(false);

  const [showTimeoutAlert, setShowTimeoutAlert] = useState(false);



  // Load Template & Data

  useEffect(() => {

    try {

      const storedTemplates = localStorage.getItem(`templates_${canvasType}`);

      const storedBaseUrl = localStorage.getItem("templates_base_url") || "";

      setBaseUrl(storedBaseUrl);



      if (storedTemplates) {

        const parsed = JSON.parse(storedTemplates) as TemplateItem[];

        const found = parsed.find(t => t.id.toString() === templateId);

        if (found) setTemplate(found);

      }



      const storedRaw = localStorage.getItem("rawPhotos");

      const storedEdits = localStorage.getItem("frameEdits");

      if (storedRaw) {

        const parsedRaw = JSON.parse(storedRaw);

        if (Array.isArray(parsedRaw) && parsedRaw.length === totalFrames) setPhotos(parsedRaw);

      }

      if (storedEdits) setFrameEdits(JSON.parse(storedEdits));

    } catch (e) { console.error(e); }

  }, [templateId, totalFrames]);



  // Session Timer Engine

  useEffect(() => {

    const storedExpiry = localStorage.getItem("session_expiry");

    let expiry = storedExpiry ? parseInt(storedExpiry, 10) : 0;

    if (!expiry) { router.push("/"); return; }



    const timer = setInterval(() => {

      const remaining = Math.max(0, Math.floor((expiry - Date.now()) / 1000));

      setTimeLeft(remaining);

      if (remaining <= 0) { 

        clearInterval(timer); 

        stopCamera(); 

        setShowTimeoutAlert(true);

        setTimeout(() => {

          router.push("/"); 

        }, 3500);

      }

      if (remaining === 60 && !showWarning) { setShowWarning(true); setTimeout(() => setShowWarning(false), 5000); }

    }, 1000);

    return () => clearInterval(timer);

  }, [router, showWarning, canvasType]);



  const updateEdit = (key: string, value: any) => {

    setFrameEdits((prev) => ({

      ...prev,

      [currentFrame]: { ...currentEdit, [key]: value },

    }));

  };



  const startCamera = useCallback(async () => {

    try {

      const preferredCameraId = localStorage.getItem("preferredCameraId");

      const constraints: MediaStreamConstraints = {

        video: {

          width: { ideal: 1920 }, height: { ideal: 1080 },

          aspectRatio: { ideal: 16/9 },

          ...(preferredCameraId ? { deviceId: preferredCameraId } : {})

        },

        audio: false,

      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      streamRef.current = stream;

      if (videoRef.current) {

        videoRef.current.srcObject = stream;

        videoRef.current.onloadedmetadata = () => {

          setCameraReady(true);

          // Initialize MediaRecorder

          if (streamRef.current) {

            try {

              let options: any = { mimeType: 'video/webm' };

              if (MediaRecorder.isTypeSupported('video/mp4; codecs="avc1.42E01E"')) {

                options = { mimeType: 'video/mp4; codecs="avc1.42E01E"' };

              } else if (MediaRecorder.isTypeSupported('video/webm; codecs=h264')) {

                options = { mimeType: 'video/webm; codecs=h264' };

              } else if (MediaRecorder.isTypeSupported('video/webm; codecs=vp8')) {

                options = { mimeType: 'video/webm; codecs=vp8' };

              }

              recorderRef.current = new MediaRecorder(streamRef.current, options);

              recorderRef.current.ondataavailable = (e) => {

                if (e.data.size > 0) chunksRef.current.push(e.data);

              };

              recorderRef.current.onstop = () => {

                const blob = new Blob(chunksRef.current, { type: 'video/webm' });

                setVideos(prev => {

                  const newVids = [...prev];

                  newVids[currentFrameRef.current] = blob;

                  return newVids;

                });

                chunksRef.current = [];

              };

            } catch (e) {

              console.error("Failed to init MediaRecorder", e);

            }

          }

        };

        videoRef.current.play().catch(() => { });

      }

    } catch (e) {

      // Basic Fallback

      try {

        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });

        streamRef.current = stream;

        if (videoRef.current) { videoRef.current.srcObject = stream; setCameraReady(true); }

      } catch (err) { console.error(err); }

    }

  }, []);



  const stopCamera = useCallback(() => {

    streamRef.current?.getTracks().forEach((t) => t.stop());

    streamRef.current = null;

  }, []);



  // Provider kamera aktif (webcam / digicamcontrol). UI di bawah tidak peduli
  // yang mana — hanya jalur pengambilan gambarnya yang berbeda.

  const {

    providerReady,

    usesWebcam,

    liveViewUrl,

    liveViewState,

    startLiveView,

    stopLiveView,

    capture: providerCapture,

    isCapturing,

    error: cameraError,

  } = useCamera({

    markSessionActive: true,

    autoStart: false,

    webcamControls: {

      start: startCamera,

      stop: stopCamera,

      isStreaming: () => !!streamRef.current,

    },

  });



  useEffect(() => {

    if (!providerReady || !usesWebcam) return;

    startCamera();

    return () => stopCamera();

  }, [providerReady, usesWebcam, startCamera, stopCamera]);



  // Jalur digiCamControl: live view via frame JPEG dari Main Process.

  useEffect(() => {

    if (!providerReady || usesWebcam) return;

    let cancelled = false;

    (async () => {

      const res = await startLiveView();

      if (!cancelled && res?.ok) setCameraReady(true);

    })();

    return () => {

      cancelled = true;

      setCameraReady(false);

      void stopLiveView();

    };

  }, [providerReady, usesWebcam, startLiveView, stopLiveView]);



  const capturePhoto = () => {

    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;

    const canvas = canvasRef.current;

    canvas.width = video.videoWidth;

    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");

    if (!ctx) return;



    const CAMERA_ZOOM = 1.08;

    const w = canvas.width;

    const h = canvas.height;

    

    // Crop out hardware black bars (e.g., from EOS Webcam Utility)

    const sw = w / CAMERA_ZOOM;

    const sh = h / CAMERA_ZOOM;

    const sx = (w - sw) / 2;

    const sy = (h - sh) / 2;



    if (isMirrored) {

      ctx.translate(w, 0);

      ctx.scale(-1, 1);

    }

    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);

    if (isMirrored) {

      ctx.setTransform(1, 0, 0, 1, 0, 0);

    }

    // Stop recording when photo is captured

    if (recorderRef.current && recorderRef.current.state === "recording") {

      recorderRef.current.stop();

    }



    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);

    setPhotos((prev) => {

      const u = [...prev];

      u[currentFrame] = dataUrl;

      return u;

    });

    setFlashActive(true);

    setTimeout(() => setFlashActive(false), 150);

    setShowPreview(true);

  };



  // Jalur digiCamControl: JPEG datang dari kamera lewat Main Process, lalu
  // diproses dengan crop/mirror yang SAMA persis dengan jalur webcam supaya
  // hasil akhirnya identik untuk template, print, dan upload.

  const [captureError, setCaptureError] = useState<string | null>(null);



  const processProviderJpeg = (dataUrl: string) =>

    new Promise<string>((resolve, reject) => {

      const img = new Image();

      img.onload = () => {

        const canvas = canvasRef.current || document.createElement("canvas");

        canvas.width = img.naturalWidth;

        canvas.height = img.naturalHeight;

        const ctx = canvas.getContext("2d");

        if (!ctx) { reject(new Error("Canvas tidak tersedia")); return; }



        const CAMERA_ZOOM = 1.08;

        const w = canvas.width;

        const h = canvas.height;

        const sw = w / CAMERA_ZOOM;

        const sh = h / CAMERA_ZOOM;

        const sx = (w - sw) / 2;

        const sy = (h - sh) / 2;



        if (isMirrored) {

          ctx.translate(w, 0);

          ctx.scale(-1, 1);

        }

        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);

        if (isMirrored) ctx.setTransform(1, 0, 0, 1, 0, 0);



        resolve(canvas.toDataURL("image/jpeg", 0.95));

      };

      img.onerror = () => reject(new Error("Foto tidak dapat dibaca"));

      img.src = dataUrl;

    });



  const captureFromProvider = async () => {

    setCaptureError(null);

    const res = await providerCapture();

    if (!res?.ok || !res.dataUrl) {

      setCaptureError(res?.error || "Kamera tidak merespon, coba lagi");

      return;

    }

    try {

      const processed = await processProviderJpeg(res.dataUrl);

      setPhotos((prev) => {

        const u = [...prev];

        u[currentFrame] = processed;

        return u;

      });

      setFlashActive(true);

      setTimeout(() => setFlashActive(false), 150);

      setShowPreview(true);

    } catch (e) {

      setCaptureError((e as Error).message);

    }

  };



  const doCapture = () => {

    if (usesWebcam) { capturePhoto(); return; }

    void captureFromProvider();

  };



  const handleNext = async () => {

    setShowPreview(false);

    const allDone = photos.every((p) => p !== null);

    if (allDone) {

      stopCamera();

      // Apply filters for final save

      const finalPhotos = await Promise.all(photos.map((raw, i) => {

        if (!raw) return null;

        return new Promise<string>((resolve) => {

          const img = new Image();

          img.onload = () => {

            const canvas = document.createElement("canvas");

            canvas.width = img.width; canvas.height = img.height;

            const ctx = canvas.getContext("2d");

            if (ctx) {

              ctx.filter = getFilterStyle(frameEdits[i] || { brightness: 0, contrast: 0, activeFilter: "normal" });

              ctx.drawImage(img, 0, 0);

            }

            resolve(canvas.toDataURL("image/jpeg", 0.95));

          };

          img.src = raw;

        });

      }));



      localStorage.setItem("rawPhotos", JSON.stringify(photos));

      localStorage.setItem("frameEdits", JSON.stringify(frameEdits));

      localStorage.setItem("capturedPhotos", JSON.stringify(finalPhotos));

      await localforage.setItem("liveVideos", videos);

      router.push(`/render?kanvas=${canvasType}&template=${templateId}&time=${timeLeft}`);

    } else {

      const nextEmpty = photos.findIndex((p, i) => i > currentFrame && p === null);

      const firstEmpty = photos.findIndex((p) => p === null);

      setCurrentFrame(nextEmpty !== -1 ? nextEmpty : firstEmpty);

    }

  };



  const handleRetake = () => {

    setPhotos((prev) => { const u = [...prev]; u[currentFrame] = null; return u; });

    setVideos((prev) => { const u = [...prev]; u[currentFrame] = null; return u; });

    setShowPreview(false);

  };



  const getFilterStyle = (editState?: any) => {

    const state = editState || currentEdit;

    const b = 100 + state.brightness;

    const c = 100 + state.contrast;

    let extra = "";

    switch (state.activeFilter) {

      case "bw": extra = " grayscale(100%)"; break;

      case "sepia": extra = " sepia(100%)"; break;

      case "vintage": extra = " sepia(50%) contrast(90%) brightness(110%) hue-rotate(-10deg)"; break;

      case "cinematic": extra = " contrast(120%) saturate(130%) brightness(95%)"; break;

      case "portrait": extra = " brightness(110%) saturate(110%) contrast(95%)"; break;

      case "vibrant": extra = " saturate(150%) contrast(110%)"; break;

      case "fade": extra = " contrast(85%) brightness(110%) saturate(80%)"; break;

    }

    return `brightness(${b}%) contrast(${c}%)${extra}`;

  };



  useEffect(() => {

    if (countdown === null) return;

    if (countdown === 3) {

      // Start recording at the beginning of countdown

      if (recorderRef.current && recorderRef.current.state === "inactive") {

        chunksRef.current = [];

        recorderRef.current.start();

      }

    }

    if (countdown === 0) { doCapture(); setCountdown(null); return; }

    const t = setTimeout(() => setCountdown(p => p !== null ? p - 1 : null), 1000);

    return () => clearTimeout(t);

  }, [countdown]);



  const getImageUrl = (path: string) => {

    if (!path) return "";

    if (path.startsWith("http")) return path;

    const cleanBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

    const cleanPath = path.startsWith("/") ? path.slice(1) : path;

    return `${cleanBaseUrl}/storage/${cleanPath}`;

  };



  const filters = [

    { id: "normal", color: "bg-slate-300", label: "Normal" },

    { id: "bw", color: "bg-slate-800", label: "B&W" },

    { id: "sepia", color: "bg-[#704214]", label: "Sepia" },

    { id: "vintage", color: "bg-[#d4b595]", label: "Vintage" },

    { id: "cinematic", color: "bg-teal-700", label: "Cine" },

    { id: "vibrant", color: "bg-fuchsia-500", label: "Vibrant" },

  ];



  return (

    <div className="relative h-screen w-full overflow-hidden bg-[#f15a09] font-sans text-slate-900 flex flex-col p-2 sm:p-3">

      <canvas ref={canvasRef} className="hidden" />



      {/* Main Container border white */}

      <div className="relative flex-1 flex flex-col border-[4px] border-white rounded-[30px] overflow-hidden bg-[#f15a09] min-h-0">

        <div className="shrink-0 flex justify-center py-2 relative">

          <button

            onClick={() => setShowBackConfirm(true)}

            className="bg-white/20 hover:bg-white/30 backdrop-blur-md text-white border-2 border-white/50 px-4 py-1.5 rounded-full font-black text-[9px] tracking-[0.15em] transition-all active:scale-95 flex items-center gap-1.5 drop-shadow-lg"

          >

            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>

            GANTI TEMPLATE

          </button>

        </div>



        <main className="flex-1 flex flex-col gap-3 px-4 pb-4 min-h-0 overflow-hidden">

          {/* Landscape top: camera + preview side by side */}

          <div className="flex-1 flex flex-row gap-4 min-h-0 overflow-hidden">

            {/* Left: SESI POTRET */}

            <div className="flex-[1.65] flex flex-col min-h-0 min-w-0 gap-2">

              <h2 className={`${mochiyPopOne.className} text-white text-base sm:text-lg uppercase tracking-widest text-center shrink-0 drop-shadow-md`}>

                SESI POTRET

              </h2>



          <div className="flex-1 min-h-0 bg-white rounded-[20px] shadow-2xl overflow-hidden relative border-3 border-white">

            {/* Video/Photo Layer */}

            <div className="absolute inset-0 bg-slate-900 overflow-hidden">

              {usesWebcam ? (

                <video

                  ref={videoRef}

                  autoPlay playsInline muted

                  className={`absolute inset-0 w-full h-full transition-opacity ${showPreview ? "opacity-0" : "opacity-100"}`}

                  style={{

                    objectFit: 'cover',

                    transform: `scaleX(${isMirrored ? -1 : 1}) scale(1.08)`,

                    filter: !showPreview ? getFilterStyle() : ""

                  }}

                />

              ) : liveViewUrl ? (

                <img

                  src={liveViewUrl}

                  alt="Live view"

                  className={`absolute inset-0 w-full h-full transition-opacity ${showPreview ? "opacity-0" : "opacity-100"}`}

                  style={{

                    objectFit: 'cover',

                    transform: `scaleX(${isMirrored ? -1 : 1}) scale(1.08)`,

                    filter: !showPreview ? getFilterStyle() : ""

                  }}

                />

              ) : (

                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/70">

                  <div className="w-10 h-10 border-4 border-white/40 border-t-transparent rounded-full animate-spin"></div>

                  <span className="text-[10px] font-black uppercase tracking-widest">

                    {liveViewState === "error" ? "Kamera tidak terhubung" : "Menyiapkan kamera..."}

                  </span>

                </div>

              )}



              {showPreview && photos[currentFrame] && (

                <img

                  src={photos[currentFrame]!}

                  className="absolute inset-0 w-full h-full object-cover z-10"

                  style={{ filter: getFilterStyle(frameEdits[currentFrame]) }}

                  alt="Preview"

                />

              )}



              {/* Countdown */}

              {countdown !== null && (

                <div className="absolute inset-0 flex items-center justify-center z-30 bg-black/20">

                  <span className={`${mochiyPopOne.className} text-[6rem] lg:text-[8rem] text-white drop-shadow-2xl animate-ping`}>{countdown}</span>

                </div>

              )}



              {/* Flash Overlay */}
              {flashActive && <div className="absolute inset-0 bg-white z-50 animate-out fade-out duration-300"></div>}

              {/* Menunggu kamera DSLR menulis file (hanya provider digiCamControl) */}
              {isCapturing && (
                <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/40 backdrop-blur-sm">
                  <div className="w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-white font-black text-[11px] uppercase tracking-widest">Mengambil foto...</span>
                </div>
              )}

              {/* Error kamera (timeout / provider tidak terhubung) */}
              {(captureError || (!usesWebcam && cameraError)) && (
                <div className="absolute top-4 left-4 right-24 z-40 bg-rose-600/95 text-white px-4 py-2 rounded-xl shadow-lg">
                  <p className="text-[10px] font-black uppercase tracking-widest leading-relaxed">
                    {captureError || cameraError}
                  </p>
                </div>
              )}

              {/* Session Timer */}
              <div className="absolute top-4 right-4 z-40 flex items-center gap-2 bg-white/30 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/50 shadow-[0_0_15px_rgba(0,0,0,0.2)] transition-all">
                <div className="w-2 h-2 rounded-full bg-[#f15a09] animate-pulse"></div>
                <span className="text-white font-black text-base tabular-nums tracking-wider drop-shadow-md">
                  {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
                </span>
              </div>
            </div>



            {/* Floating Camera Buttons Row */}

            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 w-full flex items-center justify-center px-4 gap-3">

              {!showPreview ? (

                <>

                  <button

                    onClick={() => setIsMirrored(!isMirrored)}

                    className={`w-12 h-12 rounded-full backdrop-blur-md flex items-center justify-center shadow-lg transition-all active:scale-95 border-3

                      ${isMirrored ? "bg-[#f15a09] text-white border-white" : "bg-white/90 text-[#f15a09] border-[#f15a09]"}`}

                    title="Mirror Camera"

                  >

                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/><path d="M12 20v2"/><path d="M12 14v2"/><path d="M12 8v2"/><path d="M12 2v2"/></svg>

                  </button>



                  <button

                    onClick={() => { if (cameraReady && countdown === null && !isCapturing) setCountdown(3); }}

                    className="w-20 h-20 rounded-full bg-white/90 backdrop-blur-md border-[6px] border-[#f15a09] flex items-center justify-center text-[#f15a09] shadow-2xl hover:scale-110 active:scale-95 transition-all group"

                  >

                    <div className="w-12 h-12 bg-[#f15a09] rounded-full flex items-center justify-center text-white transition-colors group-hover:bg-[#d94e08]">

                      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" /></svg>

                    </div>

                  </button>



                  {/* Spacer for centering balance */}

                  <div className="w-12 h-12"></div>

                </>

              ) : (

                <div className="flex items-center gap-3 w-full max-w-sm">

                  <button

                    onClick={handleRetake}

                    className="flex-1 h-11 rounded-xl bg-[#f15a09] text-white font-black text-sm tracking-widest shadow-lg hover:brightness-110 active:scale-95 transition-all uppercase border-2 border-white/30"

                  >

                    ULANGI

                  </button>

                  <button

                    onClick={handleNext}

                    className="flex-1 h-11 rounded-xl bg-[#f15a09] text-white font-black text-sm tracking-widest shadow-lg hover:brightness-110 active:scale-95 transition-all uppercase border-2 border-white/30"

                  >

                    {photos.every((p) => p !== null) ? "SELESAI" : "LANJUT"}

                  </button>

                </div>

              )}

            </div>

          </div>

            </div>



            {/* Right: PREVIEW */}

            <div className="flex-1 flex flex-col min-h-0 min-w-0 gap-2">

              <h2 className={`${mochiyPopOne.className} text-white text-base sm:text-lg uppercase tracking-widest text-center shrink-0 drop-shadow-md`}>

                PREVIEW

              </h2>



            <div className="flex-1 min-h-0 bg-white rounded-[20px] shadow-2xl p-3 flex items-center justify-center relative overflow-hidden border-3 border-white">

            {template ? (

              <div

                className="relative shadow-lg overflow-hidden bg-slate-50 border-2 border-slate-100"

                style={{

                  height: '100%',

                  aspectRatio: `${template.image_width}/${template.image_height}`

                }}

              >

                {/* Captured Photos Layer */}

                {(template as any).frames?.map((frame: any, i: number) => {

                  const photo = photos[i];

                  const isCurrent = i === currentFrame;

                  return (

                    <div

                      key={i}

                      onClick={() => {

                        setCurrentFrame(i);

                        if (photos[i]) setShowPreview(true);

                        else setShowPreview(false);

                      }}

                      className={`absolute overflow-hidden flex items-center justify-center transition-all duration-500 cursor-pointer pointer-events-auto

                        ${photo ? "bg-white" : "bg-slate-200"}`}

                      style={{

                        left: `${(frame.x / template.image_width) * 100}%`,

                        top: `${(frame.y / template.image_height) * 100}%`,

                        width: `${(frame.width / template.image_width) * 100}%`,

                        height: `${(frame.height / template.image_height) * 100}%`,

                        transform: `rotate(${frame.angle || 0}deg)`,

                        outline: isCurrent ? "4px solid #f15a09" : "none",

                        outlineOffset: "-4px",

                        zIndex: isCurrent ? 5 : 1,

                      }}

                    >

                      {isCurrent && !showPreview && usesWebcam ? (

                        <video

                          autoPlay playsInline muted

                          className="absolute inset-0 w-full h-full"

                          style={{ objectFit: 'cover', transform: `scaleX(${isMirrored ? -1 : 1}) scale(1.08)`, filter: getFilterStyle() }}

                          ref={(el) => {

                            if (el && streamRef.current && el.srcObject !== streamRef.current) {

                              el.srcObject = streamRef.current;

                            }

                          }}

                        />

                      ) : isCurrent && !showPreview && liveViewUrl ? (

                        <img

                          src={liveViewUrl}

                          alt=""

                          className="absolute inset-0 w-full h-full"

                          style={{ objectFit: 'cover', transform: `scaleX(${isMirrored ? -1 : 1}) scale(1.08)`, filter: getFilterStyle() }}

                        />

                      ) : (photo || (isCurrent && showPreview)) ? (

                        <img

                          src={photo || photos[currentFrame]!}

                          className="w-full h-full object-cover"

                          style={{ filter: getFilterStyle(frameEdits[i] || { brightness: 0, contrast: 0, activeFilter: "normal" }) }}

                          alt=""

                        />

                      ) : (

                        <span className="text-[#f15a09]/30 font-black text-4xl">{i + 1}</span>

                      )}

                    </div>

                  );

                })}



                {/* Template Overlay */}

                <img

                  src={getImageUrl(template.template_path)}

                  className="absolute inset-0 w-full h-full object-contain pointer-events-none z-10"

                  alt=""

                />

              </div>

            ) : (

              <div className="flex flex-col items-center gap-4">

                <div className="w-12 h-12 border-4 border-[#f15a09] border-t-transparent rounded-full animate-spin"></div>

                <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Memuat Preview...</p>

              </div>

            )}

          </div>

            </div>

          </div>



          {/* Bottom control bar (landscape) */}

          <div className="shrink-0 bg-white rounded-[20px] shadow-xl px-5 py-3 flex flex-row items-center gap-6 border-3 border-white">

              <div className="flex flex-col gap-1.5 shrink-0">

                <span className={`${mochiyPopOne.className} text-[#f15a09] text-[10px] uppercase`}>FILTER</span>

                <div className="flex flex-row gap-2">

                  {filters.map(f => (

                    <button

                      key={f.id}

                      onClick={() => updateEdit("activeFilter", f.id)}

                      className={`w-9 h-9 shrink-0 rounded-full ${f.color} border-3 transition-all relative

                            ${currentEdit.activeFilter === f.id

                          ? "border-[#f15a09] scale-110 shadow-lg ring-4 ring-orange-100"

                          : "border-white shadow-inner opacity-80 hover:opacity-100"

                        }`}

                      title={f.label}

                    >

                      {currentEdit.activeFilter === f.id && (

                        <div className="absolute inset-0 flex items-center justify-center">

                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>

                        </div>

                      )}

                    </button>

                  ))}

                </div>

              </div>



              <div className="flex-1 flex flex-col gap-1.5 min-w-0">

                <span className={`${mochiyPopOne.className} text-[#f15a09] text-[10px] uppercase`}>SESUAIKAN</span>

                <div className="flex flex-col gap-2">

                  <div className="flex items-center gap-3">

                    <span className="text-[9px] font-black text-[#f15a09] uppercase w-24 shrink-0">pencahayaan</span>

                    <input

                      type="range" min="-50" max="50" value={currentEdit.brightness}

                      onChange={(e) => updateEdit("brightness", Number(e.target.value))}

                      className="flex-1 h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-black"

                    />

                  </div>

                  <div className="flex items-center gap-3">

                    <span className="text-[9px] font-black text-[#f15a09] uppercase w-24 shrink-0">kontras</span>

                    <input

                      type="range" min="-50" max="50" value={currentEdit.contrast}

                      onChange={(e) => updateEdit("contrast", Number(e.target.value))}

                      className="flex-1 h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-black"

                    />

                  </div>

                </div>

              </div>

          </div>

        </main>



      {showWarning && (

        <div className="fixed top-28 left-1/2 -translate-x-1/2 z-50 bg-white text-[#f15a09] px-12 py-6 rounded-full shadow-[0_0_50px_rgba(241,90,9,0.3)] border-4 border-[#f15a09] animate-bounce">

          <span className={`${mochiyPopOne.className} text-2xl uppercase`}>Sisa 1 Menit!</span>

        </div>

      )}



      {/* Confimation Modal Ganti Template */}

      {showBackConfirm && (

        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-300">

          <div className="bg-white rounded-[40px] p-10 w-full max-w-md shadow-[0_30px_60px_rgba(0,0,0,0.2)] flex flex-col items-center animate-in zoom-in-95 duration-300 border-[6px] border-[#f15a09]">

            <div className="w-20 h-20 bg-orange-100 text-[#f15a09] rounded-full flex items-center justify-center mb-8">

              <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>

            </div>

            <h3 className={`${mochiyPopOne.className} text-2xl text-slate-900 mb-4 text-center uppercase`}>Ganti Template?</h3>

            <p className="text-sm text-slate-500 font-bold text-center mb-10 px-4 leading-relaxed">

              Semua foto yang sudah diambil akan <strong className="text-rose-600">Terhapus</strong> jika Anda kembali.

            </p>

            <div className="flex items-center gap-4 w-full">

              <button

                onClick={() => setShowBackConfirm(false)}

                className="flex-1 py-4 rounded-2xl font-black text-slate-400 border-4 border-slate-100 transition-colors uppercase tracking-widest"

              >

                BATAL

              </button>

              <button

                onClick={() => { 

                  stopCamera(); 

                  localStorage.removeItem("rawPhotos");

                  localStorage.removeItem("frameEdits");

                  localStorage.removeItem("capturedPhotos");

                  router.push(`/template?kanvas=${canvasType}`); 

                }}

                className="flex-1 py-4 rounded-2xl font-black text-white bg-rose-500 shadow-lg shadow-rose-200 uppercase tracking-widest"

              >

                YA, GANTI

              </button>

            </div>

          </div>

        </div>

      )}

      {/* Session Timeout Alert Modal */}

      {showTimeoutAlert && (

        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xl animate-in fade-in duration-500">

           <div className="bg-white rounded-[40px] p-12 w-full max-w-md shadow-2xl border-[8px] border-[#f15a09] flex flex-col items-center text-center animate-in zoom-in-95 duration-500">

              <div className="w-24 h-24 bg-orange-100 text-[#f15a09] rounded-full flex items-center justify-center mb-8 animate-bounce">

                 <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>

              </div>

              <h3 className={`${mochiyPopOne.className} text-3xl text-slate-900 mb-4 uppercase`}>SESI BERAKHIR</h3>

              <p className="font-bold text-slate-500 text-lg leading-relaxed mb-4">

                 Mohon maaf, waktu sesi Anda telah habis.

              </p>

              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden mt-4">

                 <div className="bg-[#f15a09] h-full animate-[progress_3.5s_linear_forwards]"></div>

              </div>

              <p className="text-xs text-slate-400 mt-4 uppercase font-black tracking-widest">Kembali ke Beranda...</p>

           </div>

        </div>

      )}



      <style jsx global>{`

        @keyframes progress {

          from { width: 100%; }

          to { width: 0%; }

      `}</style>

      </div>

    </div>

  );

}



export default function CameraPage() {

  return (

    <Suspense fallback={

      <div className="h-screen w-full flex items-center justify-center bg-[#f15a09]">

        <div className="w-16 h-16 border-8 border-white border-t-transparent rounded-full animate-spin"></div>

      </div>

    }>

      <CameraContent />

    </Suspense>

  );

}

