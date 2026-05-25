"use client";

import React, { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import localforage from "localforage";
import { Mochiy_Pop_One } from "next/font/google";

const mochiyPopOne = Mochiy_Pop_One({
  subsets: ["latin"],
  weight: "400",
});

type FlipbookStage = "cover" | "video" | "extracting" | "done";

function FlipbookCameraContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const canvasType = searchParams.get("kanvas") || "flipbook";
  const templateId = searchParams.get("template") || "1";
  const [initialTime, setInitialTime] = useState(300);
  useEffect(() => {
    const savedTimeout = localStorage.getItem("sessionTimeout");
    const timeout = savedTimeout ? parseInt(savedTimeout, 10) : 300;
    setInitialTime(Number(searchParams.get("time")) || timeout);
  }, [searchParams]);

  // Camera refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<BlobPart[]>([]);

  // Stage flow
  const [stage, setStage] = useState<FlipbookStage>("cover");
  const [cameraReady, setCameraReady] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [videoCountdown, setVideoCountdown] = useState<number | null>(null);
  const [flashActive, setFlashActive] = useState(false);
  const [showBackConfirm, setShowBackConfirm] = useState(false);

  // Cover photo
  const [coverPhoto, setCoverPhoto] = useState<string | null>(null);
  const [showCoverPreview, setShowCoverPreview] = useState(false);

  // Video recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const VIDEO_DURATION = 10; // seconds
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [showVideoPreview, setShowVideoPreview] = useState(false);

  // Extracted frames
  const [extractedFrames, setExtractedFrames] = useState<string[]>([]);
  const [extractionProgress, setExtractionProgress] = useState(0);

  // Filter/Edit states
  const [coverEdit, setCoverEdit] = useState({ brightness: 0, contrast: 0, activeFilter: "normal" });
  const [videoEdit, setVideoEdit] = useState({ brightness: 0, contrast: 0, activeFilter: "normal" });

  const [timeLeft, setTimeLeft] = useState(300);
  useEffect(() => {
    const savedTimeout = localStorage.getItem("sessionTimeout");
    if (savedTimeout) setTimeLeft(parseInt(savedTimeout, 10));
  }, []);
  const [showWarning, setShowWarning] = useState(false);
  const [showTimeoutAlert, setShowTimeoutAlert] = useState(false);

  const videoPreviewUrl = React.useMemo(() => {
    if (!videoBlob) return null;
    return URL.createObjectURL(videoBlob);
  }, [videoBlob]);

  useEffect(() => {
    return () => { if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl); };
  }, [videoPreviewUrl]);

  // Load Timer
  useEffect(() => {
    const storedExpiry = localStorage.getItem("session_expiry");
    if (!storedExpiry) { router.push("/"); return; }
    let expiry = parseInt(storedExpiry, 10);
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
  }, [router, showWarning]);

  // ── Camera ─────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    try {
      const preferredCameraId = localStorage.getItem("preferredCameraId");
      const constraints: MediaStreamConstraints = {
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, aspectRatio: { ideal: 16/9 }, ...(preferredCameraId ? { deviceId: preferredCameraId } : {}) },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => { videoRef.current?.play().catch(() => {}); setCameraReady(true); };
      }
    } catch (e) {
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

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, [startCamera, stopCamera]);

  const getFilterStyle = (editState?: any) => {
    const state = editState || (stage === "cover" ? coverEdit : videoEdit);
    const b = 100 + state.brightness;
    const c = 100 + state.contrast;
    let extra = "";
    switch (state.activeFilter) {
      case "bw": extra = " grayscale(100%)"; break;
      case "sepia": extra = " sepia(100%)"; break;
      case "vintage": extra = " sepia(50%) contrast(90%) brightness(110%) hue-rotate(-10deg)"; break;
      case "cinematic": extra = " contrast(120%) saturate(130%) brightness(95%)"; break;
      case "vibrant": extra = " saturate(150%) contrast(110%)"; break;
    }
    return `brightness(${b}%) contrast(${c}%)${extra}`;
  };

  const updateEdit = (key: string, value: any) => {
    if (stage === "cover") setCoverEdit(p => ({ ...p, [key]: value }));
    else setVideoEdit(p => ({ ...p, [key]: value }));
  };

  // ── ATOM ACTIONS ───────────────────────────────────────────
  const handleShutter = () => {
    if (!cameraReady || countdown !== null || videoCountdown !== null) return;
    if (stage === "cover") setCountdown(3);
    else if (stage === "video") setVideoCountdown(3);
  };

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) { captureCoverPhoto(); setCountdown(null); return; }
    const t = setTimeout(() => setCountdown(p => p !== null ? p - 1 : null), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // Video countdown — mirrors cover countdown, triggers recording at 0
  useEffect(() => {
    if (videoCountdown === null) return;
    if (videoCountdown === 0) { startVideoRecording(); setVideoCountdown(null); return; }
    const t = setTimeout(() => setVideoCountdown(p => p !== null ? p - 1 : null), 1000);
    return () => clearTimeout(t);
  }, [videoCountdown]);

  const captureCoverPhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.translate(canvas.width, 0); ctx.scale(-1, 1);
    ctx.drawImage(videoRef.current, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    setCoverPhoto(canvas.toDataURL("image/jpeg", 0.95));
    setFlashActive(true); setTimeout(() => setFlashActive(false), 150);
    setShowCoverPreview(true);
  };

  const startVideoRecording = () => {
    if (!streamRef.current || isRecording) return;
    videoChunksRef.current = [];
    let options: any = { mimeType: 'video/webm' };
    // Prioritaskan h264/mp4 karena dukungan Hardware Acceleration lebih luas di mesin lama (mencegah lag CPU)
    if (MediaRecorder.isTypeSupported('video/mp4; codecs="avc1.42E01E"')) {
      options = { mimeType: 'video/mp4; codecs="avc1.42E01E"' };
    } else if (MediaRecorder.isTypeSupported('video/webm; codecs=h264')) {
      options = { mimeType: 'video/webm; codecs=h264' };
    }
    // Jika tidak ada H264, browser akan otomatis menggunakan default VP8 yang lebih ringan dibanding VP9
    try {
      const recorder = new MediaRecorder(streamRef.current, options);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data.size > 0) videoChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(videoChunksRef.current, { type: recorder.mimeType || 'video/webm' });
        setVideoBlob(blob);
        setShowVideoPreview(true);
      };
      recorder.start(100);
      setIsRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime((prev) => {
          if (prev >= VIDEO_DURATION - 1) {
            if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
            if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
            setIsRecording(false);
            return VIDEO_DURATION;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (e) { console.error(e); }
  };

  const handleNextStage = () => {
    if (stage === "cover") { setShowCoverPreview(false); setStage("video"); }
    else if (stage === "video") { setShowVideoPreview(false); setStage("extracting"); extractFrames(videoBlob!); }
  };

  const handleRetake = () => {
    if (stage === "cover") { setCoverPhoto(null); setShowCoverPreview(false); }
    else if (stage === "video") { setVideoBlob(null); setShowVideoPreview(false); setRecordingTime(0); }
  };

  // Helper: Check if a canvas frame has actual content (not just blank white/black)
  const isFrameBlank = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): boolean => {
    // Sample a few pixels from different areas to check if the frame has real content
    const w = canvas.width;
    const h = canvas.height;
    const samplePoints = [
      { x: Math.floor(w * 0.25), y: Math.floor(h * 0.25) },
      { x: Math.floor(w * 0.5), y: Math.floor(h * 0.5) },
      { x: Math.floor(w * 0.75), y: Math.floor(h * 0.75) },
      { x: Math.floor(w * 0.25), y: Math.floor(h * 0.75) },
      { x: Math.floor(w * 0.75), y: Math.floor(h * 0.25) },
    ];
    let allSame = true;
    let firstPixel: number[] | null = null;
    for (const pt of samplePoints) {
      const pixel = ctx.getImageData(pt.x, pt.y, 1, 1).data;
      if (!firstPixel) {
        firstPixel = [pixel[0], pixel[1], pixel[2]];
      } else {
        // If any pixel differs from the first, frame has content
        if (Math.abs(pixel[0] - firstPixel[0]) > 10 ||
            Math.abs(pixel[1] - firstPixel[1]) > 10 ||
            Math.abs(pixel[2] - firstPixel[2]) > 10) {
          allSame = false;
          break;
        }
      }
    }
    return allSame; // all sampled pixels are the same = blank
  };

  // Helper: Seek video to a specific time and wait for readiness
  const seekVideoAndWait = (vid: HTMLVideoElement, time: number): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const MAX_RETRIES = 3;
      let attempts = 0;

      const attemptSeek = () => {
        attempts++;
        let settled = false;

        const onSeeked = () => {
          if (settled) return;
          settled = true;
          vid.removeEventListener("seeked", onSeeked);
          clearTimeout(timeoutId);
          // Additional small delay to ensure video decoder has painted the frame
          requestAnimationFrame(() => resolve(true));
        };

        vid.addEventListener("seeked", onSeeked);
        vid.currentTime = time;

        // Timeout: if the seek doesn't complete, retry or fail gracefully
        const timeoutId = setTimeout(() => {
          if (settled) return;
          settled = true;
          vid.removeEventListener("seeked", onSeeked);
          if (attempts < MAX_RETRIES) {
            console.warn(`[Flipbook] Seek to ${time.toFixed(2)}s timed out, retrying (${attempts}/${MAX_RETRIES})...`);
            attemptSeek();
          } else {
            console.warn(`[Flipbook] Seek to ${time.toFixed(2)}s failed after ${MAX_RETRIES} retries, using current frame.`);
            resolve(false);
          }
        }, 1500); // 1.5s timeout per attempt
      };

      attemptSeek();
    });
  };

  const extractFrames = async (blob: Blob) => {
    const videoUrl = URL.createObjectURL(blob);
    const vid = document.createElement("video");
    vid.src = videoUrl;
    vid.muted = true;
    vid.playsInline = true;
    vid.preload = "auto";

    await new Promise<void>((resolve) => {
      vid.onloadeddata = () => resolve();
      vid.onloadedmetadata = () => {
        // Also try to load enough data
        if (vid.readyState >= 2) resolve();
      };
      vid.onerror = () => resolve();
      // Safety timeout in case loadeddata never fires
      setTimeout(() => resolve(), 5000);
    });

    let duration = vid.duration;
    if (!duration || !isFinite(duration)) {
      duration = VIDEO_DURATION;
    }

    const totalExtractFrames = 39;
    const interval = duration / totalExtractFrames;

    const storedTemplatesJSON = localStorage.getItem("templates");
    const templates: any[] = storedTemplatesJSON ? JSON.parse(storedTemplatesJSON) : [];
    const tpl = templates.find((t) => t.id.toString() === templateId);

    if (!tpl) {
      URL.revokeObjectURL(videoUrl);
      return;
    }

    const tw = parseInt(tpl.image_width, 10) || 1080;
    const th = parseInt(tpl.image_height, 10) || 1920;
    const templateFrames = tpl.frames || [];

    const frames: string[] = [];
    const extractCanvas = document.createElement("canvas");
    extractCanvas.width = tw;
    extractCanvas.height = th;
    const ctx = extractCanvas.getContext("2d");

    if (!ctx) {
      URL.revokeObjectURL(videoUrl);
      return;
    }

    // Helper to draw the current video frame onto the canvas
    const drawCurrentVideoFrame = () => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, tw, th);

      for (let f = 0; f < (templateFrames.length || 1); f++) {
        const fr = templateFrames[f] || { x: 0, y: 0, width: tw, height: th };
        const fx = parseInt(fr.x, 10);
        const fy = parseInt(fr.y, 10);
        const fw = parseInt(fr.width, 10);
        const fh = parseInt(fr.height, 10);

        const vrRatio = vid.videoWidth / vid.videoHeight;
        const frRatio = fw / fh;
        let vsx = 0, vsy = 0, vsw = vid.videoWidth, vsh = vid.videoHeight;
        if (vrRatio > frRatio) {
          vsw = vid.videoHeight * frRatio;
          vsx = (vid.videoWidth - vsw) / 2;
        } else {
          vsh = vid.videoWidth / frRatio;
          vsy = (vid.videoHeight - vsh) / 2;
        }

        ctx.save();
        ctx.translate(fx + fw, fy);
        ctx.scale(-1, 1);
        ctx.filter = getFilterStyle(videoEdit);
        ctx.drawImage(vid, vsx, vsy, vsw, vsh, 0, 0, fw, fh);
        ctx.restore();
      }

      ctx.filter = "none";
    };

    let lastGoodFrame: string | null = null;

    for (let i = 0; i < totalExtractFrames; i++) {
      const seekTime = Math.min(i * interval, duration - 0.01);
      
      // Seek and wait for video readiness
      await seekVideoAndWait(vid, seekTime);

      // Draw the frame
      drawCurrentVideoFrame();

      // Validate: check if the frame has actual content
      const blank = isFrameBlank(extractCanvas, ctx);
      
      if (blank && lastGoodFrame) {
        // Frame is blank — retry once with a slight time offset
        console.warn(`[Flipbook] Frame ${i} appears blank, retrying with offset...`);
        const retryTime = Math.min(seekTime + 0.05, duration - 0.01);
        await seekVideoAndWait(vid, retryTime);
        drawCurrentVideoFrame();
        
        if (isFrameBlank(extractCanvas, ctx)) {
          // Still blank — use the last known good frame instead of a blank
          console.warn(`[Flipbook] Frame ${i} still blank after retry, using last good frame.`);
          frames.push(lastGoodFrame);
          setExtractionProgress(Math.round(((i + 1) / totalExtractFrames) * 100));
          continue;
        }
      }

      const frameData = extractCanvas.toDataURL("image/jpeg", 0.92);
      frames.push(frameData);
      if (!blank) {
        lastGoodFrame = frameData;
      }
      setExtractionProgress(Math.round(((i + 1) / totalExtractFrames) * 100));
    }

    URL.revokeObjectURL(videoUrl);
    setExtractedFrames(frames);
    setStage("done");

    localStorage.setItem("flipbook_cover", coverPhoto || "");
    localStorage.setItem("flipbook_frames", JSON.stringify(frames));
    localStorage.setItem("flipbook_coverEdit", JSON.stringify(coverEdit));
    localStorage.setItem("flipbook_videoEdit", JSON.stringify(videoEdit));

    await localforage.setItem("flipbook_video", blob);
    stopCamera();
    router.push(`/flipbook-render?kanvas=${canvasType}&template=${templateId}&time=${timeLeft}`);
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
    <div className="relative h-screen w-full overflow-hidden bg-[#f15a09] font-sans text-slate-900 flex flex-col p-4">
      <canvas ref={canvasRef} className="hidden" />

      <div className="relative flex-1 flex flex-col border-[4px] border-white rounded-[30px] overflow-hidden bg-[#f15a09]">
        
        <header className="w-full flex justify-between items-center px-6 py-3 shrink-0 h-14 relative">
          <h2 className={`${mochiyPopOne.className} text-white text-lg uppercase tracking-widest drop-shadow-md`}>SESI POTRET</h2>
          <button onClick={() => setShowBackConfirm(true)} className="absolute left-1/2 -translate-x-1/2 bg-white/20 hover:bg-white/30 backdrop-blur-md text-white border-2 border-white/50 px-6 py-2 rounded-full font-black text-[10px] tracking-[0.2em] transition-all active:scale-95 flex items-center gap-2 shadow-lg scale-90">
             <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
             GANTI TEMPLATE
          </button>
          <h2 className={`${mochiyPopOne.className} text-white text-lg uppercase tracking-widest drop-shadow-md`}>PREVIEW</h2>
        </header>

        <main className="flex-1 flex flex-col gap-4 px-4 pb-4 overflow-hidden">
          
          {/* Viewfinder (Top) */}
          <div className="flex-[1.2] bg-white rounded-[24px] shadow-2xl overflow-hidden relative border-3 border-white shrink-0">
              <div className="absolute inset-0 bg-slate-900 overflow-hidden">
                <video ref={videoRef} autoPlay playsInline muted className={`absolute inset-0 w-full h-full transition-opacity ${showCoverPreview || showVideoPreview ? "opacity-0" : "opacity-100"}`} style={{ objectFit: 'cover', transform: 'scaleX(-1)', filter: getFilterStyle() }} />
                {showCoverPreview && coverPhoto && <img src={coverPhoto} className="absolute inset-0 w-full h-full object-cover z-10" style={{ filter: getFilterStyle(coverEdit) }} alt="Cover" />}
                {showVideoPreview && videoPreviewUrl && <video src={videoPreviewUrl} autoPlay loop muted className="absolute inset-0 w-full h-full z-10" style={{ objectFit: 'cover', transform: 'scaleX(-1)', filter: getFilterStyle(videoEdit) }} />}
                
                {(countdown !== null || videoCountdown !== null) && (
                   <div className="absolute inset-0 flex items-center justify-center z-30 bg-black/20">
                      <span className={`${mochiyPopOne.className} text-[10rem] text-white animate-ping`}>{countdown ?? videoCountdown}</span>
                   </div>
                )}
                {isRecording && (
                  <div className="absolute top-0 left-0 right-0 z-30 h-3 bg-white/20">
                    <div className="h-full bg-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.5)] transition-all duration-1000 ease-linear" style={{ width: `${(recordingTime/VIDEO_DURATION)*100}%` }}></div>
                  </div>
                )}
                {stage === "extracting" && (
                   <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-900/95 backdrop-blur-xl gap-8">
                      <div className="w-32 h-32 relative flex items-center justify-center">
                         <svg className="w-full h-full" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="none" stroke="#ffffff10" strokeWidth="8" /><circle cx="50" cy="50" r="45" fill="none" stroke="#f15a09" strokeWidth="8" strokeDasharray="283" strokeDashoffset={`${283 - (283 * extractionProgress) / 100}`} strokeLinecap="round" transform="rotate(-90 50 50)" /></svg>
                         <span className="absolute text-3xl font-black text-white">{extractionProgress}%</span>
                      </div>
                      <h3 className={`${mochiyPopOne.className} text-xl text-white uppercase`}>MEMPROSES...</h3>
                   </div>
                )}
                {flashActive && <div className="absolute inset-0 bg-white z-50 animate-out fade-out"></div>}
              </div>

              {/* Floating Buttons */}
              <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-40 w-full flex flex-col items-center gap-4">
                {!(showCoverPreview || showVideoPreview) ? (
                  <button onClick={handleShutter} className={`w-24 h-24 rounded-full bg-white/90 backdrop-blur-md border-[8px] flex items-center justify-center shadow-2xl hover:scale-110 active:scale-95 transition-all group ${stage === 'cover' ? 'border-[#f15a09]' : 'border-rose-500'}`}>
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white ${stage === 'cover' ? 'bg-[#f15a09]' : 'bg-rose-500'}`}>
                        {stage === 'cover' ? <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg> : <div className="w-5 h-5 bg-white rounded-full"></div>}
                    </div>
                  </button>
                ) : (
                  <div className="flex gap-6 w-full max-w-lg px-10">
                    <button onClick={handleRetake} className="flex-1 h-16 rounded-2xl bg-white/90 text-[#f15a09] border-4 border-[#f15a09] font-black text-xl shadow-2xl uppercase">ULANGI</button>
                    <button onClick={handleNextStage} className="flex-1 h-16 rounded-2xl bg-[#f15a09] text-white font-black text-xl shadow-2xl uppercase border-4 border-white/20">
                      {(coverPhoto && videoBlob) ? "SELESAI" : "LANJUT"}
                    </button>
                  </div>
                )}
              </div>
          </div>

          {/* Bottom Split Area (Preview + Filters) */}
          <div className="flex-1 flex gap-4 overflow-hidden min-h-0">

             {/* Preview Panel (Bottom Left) */}
             <div className="flex-[1.2] bg-white rounded-[24px] shadow-2xl p-4 flex flex-col gap-3 overflow-y-auto border-3 border-white custom-scrollbar">
             {/* Step 1: Cover */}
             <div 
                onClick={() => {
                  setStage('cover');
                  if (coverPhoto) setShowCoverPreview(true);
                  setShowVideoPreview(false);
                }}
                className={`relative flex-1 rounded-3xl overflow-hidden border-4 transition-all cursor-pointer ${stage === 'cover' ? 'border-[#f15a09] shadow-lg shadow-orange-100' : 'border-slate-100 opacity-60'}`}
             >
                {coverPhoto ? (
                  <img src={coverPhoto} className="w-full h-full object-cover" style={{ filter: getFilterStyle(coverEdit) }} alt="" />
                ) : (
                  <div className="w-full h-full bg-slate-50 flex flex-col items-center justify-center gap-3">
                    <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-inner text-slate-300">
                      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
                    </div>
                    <span className="font-black text-slate-300 text-xs tracking-[0.2em] uppercase">Cover Sampul</span>
                  </div>
                )}
                <div className="absolute top-4 left-4 bg-white/90 px-4 py-1.5 rounded-full text-[10px] font-black text-[#f15a09] backdrop-blur shadow-sm">TAHAP 1</div>
             </div>

             {/* Step 2: Video */}
             <div 
                onClick={() => {
                  if (stage === 'extracting' || stage === 'done') return;
                  setStage('video');
                  if (videoBlob) setShowVideoPreview(true);
                  setShowCoverPreview(false);
                }}
                className={`relative flex-1 rounded-3xl overflow-hidden border-4 transition-all cursor-pointer ${stage === 'video' ? 'border-[#f15a09] shadow-lg shadow-orange-100' : 'border-slate-100 opacity-60'}`}
             >
                {videoBlob ? (
                  <video src={videoPreviewUrl || ""} autoPlay loop muted className="absolute inset-0 w-full h-full" style={{ objectFit: 'cover', transform: 'scaleX(-1)', filter: getFilterStyle(videoEdit) }} />
                ) : (
                  <div className="w-full h-full bg-slate-50 flex flex-col items-center justify-center gap-3">
                    <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-inner text-slate-300">
                      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 8-6 4 6 4V8Z" /><rect width="14" height="12" x="2" y="6" rx="2" ry="2" /></svg>
                    </div>
                    <span className="font-black text-slate-300 text-xs tracking-[0.2em] uppercase">Konten Video</span>
                  </div>
                )}
                <div className="absolute top-4 left-4 bg-white/90 px-4 py-1.5 rounded-full text-[10px] font-black text-[#f15a09] backdrop-blur shadow-sm">TAHAP 2</div>
                {isRecording && <div className="absolute inset-0 bg-rose-500/10 animate-pulse flex items-center justify-center font-black text-rose-500 text-3xl">REC {recordingTime}S</div>}
             </div>

             {/* Frames Progress (Opsional: Muncul jika sedang diproses) */}
             {stage === "extracting" && (
               <div className="h-20 bg-orange-50 rounded-2xl flex items-center px-6 gap-4 border-2 border-orange-200">
                  <div className="animate-spin w-6 h-6 border-4 border-[#f15a09] border-t-transparent rounded-full"></div>
                  <span className="font-black text-[10px] text-[#f15a09] uppercase tracking-widest">Mengekstrak Frame Flipbook...</span>
               </div>
             )}
          </div>

             {/* Filter & Adjustments Panel (Bottom Right) */}
             <div className="flex-1 bg-white rounded-[24px] shadow-2xl p-5 flex flex-col gap-5 overflow-y-auto border-3 border-white custom-scrollbar">
                
                <div className="flex flex-col gap-2">
                  <span className={`${mochiyPopOne.className} text-[#f15a09] text-[10px] uppercase`}>FILTER ({(stage === "cover" || showCoverPreview) ? "Sampul" : "Video"})</span>
                  <div className="grid grid-cols-4 gap-2">
                    {filters.map(f => (
                      <button key={f.id} onClick={() => updateEdit("activeFilter", f.id)} className={`w-10 h-10 rounded-full ${f.color} border-3 transition-all relative mx-auto ${((stage === "cover" || showCoverPreview) ? coverEdit.activeFilter : videoEdit.activeFilter) === f.id ? "border-[#f15a09] scale-110 shadow-lg" : "border-white shadow-inner opacity-80"}`}>
                        {((stage === "cover" || showCoverPreview) ? coverEdit.activeFilter : videoEdit.activeFilter) === f.id && <div className="absolute inset-0 flex items-center justify-center"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg></div>}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="w-full h-1 bg-slate-50 rounded-full"></div>

                <div className="flex flex-col gap-3">
                  <span className={`${mochiyPopOne.className} text-[#f15a09] text-[10px] uppercase`}>SESUAIKAN</span>
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between items-center px-0.5">
                        <span className="text-[9px] font-black text-slate-400 uppercase">pencahayaan</span>
                        <span className="text-[9px] font-black text-[#f15a09]">{(stage === "cover" || showCoverPreview) ? coverEdit.brightness : videoEdit.brightness}</span>
                      </div>
                      <input type="range" min="-50" max="50" value={(stage === "cover" || showCoverPreview) ? coverEdit.brightness : videoEdit.brightness} onChange={(e) => updateEdit("brightness", Number(e.target.value))} className="w-full h-2 bg-slate-100 rounded-full appearance-none accent-[#f15a09]" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between items-center px-0.5">
                        <span className="text-[9px] font-black text-slate-400 uppercase">kontras</span>
                        <span className="text-[9px] font-black text-[#f15a09]">{(stage === "cover" || showCoverPreview) ? coverEdit.contrast : videoEdit.contrast}</span>
                      </div>
                      <input type="range" min="-50" max="50" value={(stage === "cover" || showCoverPreview) ? coverEdit.contrast : videoEdit.contrast} onChange={(e) => updateEdit("contrast", Number(e.target.value))} className="w-full h-2 bg-slate-100 rounded-full appearance-none accent-[#f15a09]" />
                    </div>
                  </div>
                </div>

                <div className="mt-auto pt-4">
                  <div className="flex items-center justify-center gap-2 bg-orange-50 px-4 py-3 rounded-full border-2 border-[#f15a09]/20 shadow-inner">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#f15a09] animate-pulse"></div>
                    <span className="text-[#f15a09] font-black text-xl tabular-nums tracking-wider">
                      {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
                    </span>
                  </div>
                </div>
             </div>
          </div>
        </main>

      </div>

      {showBackConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-md">
          <div className="bg-white rounded-[40px] p-10 w-full max-w-md shadow-2xl border-[6px] border-[#f15a09] text-center">
            <h3 className={`${mochiyPopOne.className} text-xl uppercase mb-4`}>Ganti Template?</h3>
            <p className="font-bold text-slate-500 mb-8 text-sm leading-relaxed">Semua foto & video yang sudah diambil akan <strong className="text-rose-600 underline">TERHAPUS</strong> jika Anda kembali.</p>
            <div className="flex gap-4">
               <button onClick={() => setShowBackConfirm(false)} className="flex-1 py-4 rounded-2xl font-black text-slate-400 border-4 border-slate-50 transition-all">Batal</button>
               <button onClick={() => { stopCamera(); router.push(`/template?kanvas=${canvasType}`); }} className="flex-1 py-4 rounded-2xl font-black text-white bg-rose-500 shadow-lg">Ya, Ganti</button>
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
        }
      `}</style>
    </div>
  );
}

export default function FlipbookCameraPage() {
  return (
    <Suspense fallback={<div className="h-screen w-full flex items-center justify-center bg-[#f15a09]"><div className="w-16 h-16 border-8 border-white border-t-transparent rounded-full animate-spin"></div></div>}>
      <FlipbookCameraContent />
    </Suspense>
  );
}
