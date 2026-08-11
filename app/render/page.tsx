"use client";

import React, { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import localforage from "localforage";
import { Mochiy_Pop_One } from "next/font/google";

const mochiyPopOne = Mochiy_Pop_One({
  subsets: ["latin"],
  weight: "400",
});

function RenderContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const canvasType = searchParams.get("kanvas") || "koran";
  const templateId = searchParams.get("template");
  const initialTime = Number(searchParams.get("time")) || 60;

  // Basic States
  const [isLoading, setIsLoading] = useState(true);
  const [baseImage, setBaseImage] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(initialTime);
  useEffect(() => {
    if (!searchParams.get("time")) {
      const savedTimeout = localStorage.getItem("sessionTimeout");
      if (savedTimeout) setTimeLeft(parseInt(savedTimeout, 10));
    }
  }, [searchParams]);
  const [showWarning, setShowWarning] = useState(false);
  const [showTimeoutAlert, setShowTimeoutAlert] = useState(false);
  const [dim, setDim] = useState({ w: 1000, h: 1000 });
  const [baseUrl, setBaseUrl] = useState("");
  const [isRenderingVideo, setIsRenderingVideo] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const animationFrameRef = useRef<number | null>(null);

  // Drawing Canvas Logic
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState("#ffffff");
  const [brushSize, setBrushSize] = useState(10);

  // Sticker Feature Logic
  const [activeMode, setActiveMode] = useState<"draw" | "sticker">("sticker");
  const [stickersList, setStickersList] = useState<any[]>([]);
  const [placedStickers, setPlacedStickers] = useState<any[]>([]);
  const [selectedStickerId, setSelectedStickerId] = useState<string | null>(null);

  useEffect(() => {
    const processImages = async () => {
      try {
        const storedPhotosJSON = localStorage.getItem("capturedPhotos");
        const storedTemplatesJSON = localStorage.getItem(`templates_${canvasType}`);
        const storedStickersJSON = localStorage.getItem("stickers");
        const storedBaseUrl = localStorage.getItem("templates_base_url") || "";

        setBaseUrl(storedBaseUrl);
        if (storedStickersJSON) {
          setStickersList(JSON.parse(storedStickersJSON));
        }

        if (!storedPhotosJSON || !storedTemplatesJSON) {
          router.push("/");
          return;
        }

        const photos: string[] = JSON.parse(storedPhotosJSON);
        const templates: any[] = JSON.parse(storedTemplatesJSON);
        const template = templates.find((t) => t.id.toString() === templateId);

        if (!template) {
          router.push("/");
          return;
        }

        const tw = parseInt(template.image_width, 10);
        const th = parseInt(template.image_height, 10);
        setDim({ w: tw, h: th });

        // Setup Offscreen Canvas
        const offCanvas = document.createElement("canvas");
        offCanvas.width = tw;
        offCanvas.height = th;
        const ctx = offCanvas.getContext("2d");

        if (!ctx) return;

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, tw, th);

        // Draw Photos
        const frames = template.frames || [];
        const totalSteps = photos.length + 1; // Photos + Template
        
        for (let i = 0; i < photos.length; i++) {
          setLoadingProgress(Math.round(((i + 1) / totalSteps) * 100));
          if (!photos[i] || !frames[i]) continue;

          await new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => {
              const x = parseInt(frames[i].x, 10);
              const y = parseInt(frames[i].y, 10);
              const fw = parseInt(frames[i].width, 10);
              const fh = parseInt(frames[i].height, 10);
              const angle = frames[i].angle ? parseFloat(frames[i].angle) : 0;
              const imgRatio = img.width / img.height;
              const frameRatio = fw / fh;

              let sx = 0, sy = 0, sw = img.width, sh = img.height;
              if (imgRatio > frameRatio) {
                sw = img.height * frameRatio;
                sx = (img.width - sw) / 2;
              } else {
                sh = img.width / frameRatio;
                sy = (img.height - sh) / 2;
              }
              
              ctx.save();
              ctx.translate(x + fw / 2, y + fh / 2);
              ctx.rotate((angle * Math.PI) / 180);
              ctx.drawImage(img, sx, sy, sw, sh, -fw / 2, -fh / 2, fw, fh);
              ctx.restore();
              
              resolve();
            };
            img.src = photos[i];
          });
        }

        // Draw Template
        if (template.template_path) {
          await new Promise<void>((resolve) => {
            const tImg = new Image();
            tImg.crossOrigin = "anonymous";
            tImg.onload = () => {
              ctx.drawImage(tImg, 0, 0, tw, th);
              resolve();
            };
            tImg.onerror = () => resolve();

            let fullPath = template.template_path;
            if (!fullPath.startsWith('http')) {
              const cleanBaseUrl = storedBaseUrl.endsWith("/") ? storedBaseUrl.slice(0, -1) : storedBaseUrl;
              const cleanPath = fullPath.startsWith("/") ? fullPath.slice(1) : fullPath;
              fullPath = `${cleanBaseUrl}/storage/${cleanPath}`;
            }
            tImg.src = `/api/image-proxy?url=${encodeURIComponent(fullPath)}`;
          });
        }
        setLoadingProgress(100);

        setBaseImage(offCanvas.toDataURL("image/jpeg", 0.95));
        setIsLoading(false);

        setTimeout(() => {
          if (canvasRef.current) {
            setHistory([canvasRef.current.toDataURL()]);
          }
        }, 100);

      } catch (e) {
        console.error(e);
        router.push("/");
      }
    };
    processImages();
  }, [router, templateId]);

  // -- Timer Engine 
  useEffect(() => {
    if (isLoading) return;
    if (timeLeft <= 0) {
      if (!showTimeoutAlert) {
         setShowTimeoutAlert(true);
         setTimeout(() => {
            document.getElementById("btn-finish")?.click();
         }, 3500);
      }
      return;
    }
    if (timeLeft === 60 && !showWarning) {
      setShowWarning(true);
      setTimeout(() => setShowWarning(false), 5000);
    }
    const timer = setInterval(() => setTimeLeft((p) => p - 1), 1000);
    return () => clearInterval(timer);
  }, [timeLeft, showWarning, isLoading, showTimeoutAlert]);

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  // -- Math Helpers
  const getCoordinates = (e: any) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    let clientX = e.clientX;
    let clientY = e.clientY;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }
    const scaleX = dim.w / rect.width;
    const scaleY = dim.h / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  // -- Drawing Engine
  const startDrawing = (e: any) => {
    if (activeMode !== "draw") return;
    e.preventDefault();
    const { x, y } = getCoordinates(e);
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = color;
      ctx.lineWidth = brushSize;
      setIsDrawing(true);
    }
  };

  const draw = (e: any) => {
    if (activeMode !== "draw" || !isDrawing) return;
    e.preventDefault();
    const { x, y } = getCoordinates(e);
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };

  const stopDrawing = () => {
    if (activeMode !== "draw" || !isDrawing) return;
    setIsDrawing(false);
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) ctx.closePath();
    if (canvasRef.current) {
      setHistory(prev => [...prev, canvasRef.current!.toDataURL()]);
    }
  };

  // Simpan state kosong awal saat canvas pertama kali siap
  useEffect(() => {
    if (!isLoading && canvasRef.current && history.length === 0) {
      const blankState = canvasRef.current.toDataURL();
      setHistory([blankState]);
    }
  }, [isLoading]);

  const handleUndo = () => {
    if (history.length <= 1) {
      // Kembali ke canvas kosong
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, dim.w, dim.h);
      return;
    }
    const newHistory = [...history];
    newHistory.pop();
    const previousState = newHistory[newHistory.length - 1];
    setHistory(newHistory);
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, dim.w, dim.h);
        ctx.drawImage(img, 0, 0);
      };
      img.src = previousState;
    }
  };

  const handleClear = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && canvasRef.current) {
      ctx.clearRect(0, 0, dim.w, dim.h);
      const blankState = canvasRef.current.toDataURL();
      setHistory([blankState]);
    }
  };

  // -- Sticker Engine
  const addSticker = (stickerItem: any) => {
    setActiveMode("sticker");
    let fullPath = stickerItem.image_path;
    if (!fullPath.startsWith('http')) {
      const cleanBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
      const cleanPath = fullPath.startsWith("/") ? fullPath.slice(1) : fullPath;
      fullPath = `${cleanBaseUrl}/storage/${cleanPath}`;
    }

    setPlacedStickers((prev) => [
      ...prev,
      {
        id: `sticker_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        url: `/api/image-proxy?url=${encodeURIComponent(fullPath)}`,
        x: dim.w / 2, // center
        y: dim.h / 2, // center
        scale: 1.25,
        rotation: 0,
      }
    ]);
  };

  // Sticker Dragging Logic
  const dragState = useRef<{ isDragging: boolean; action: 'move' | 'rotate' | 'scale'; id: string | null; startX: number; startY: number; initX: number; initY: number; initRot: number; initScale: number }>({
    isDragging: false, action: 'move', id: null, startX: 0, startY: 0, initX: 0, initY: 0, initRot: 0, initScale: 1
  });

  const onStickerPointerDown = (e: any, stickerId: string, action: 'move' | 'rotate' | 'scale' = 'move') => {
    if (activeMode !== "sticker") return;
    e.stopPropagation();
    e.preventDefault();
    setSelectedStickerId(stickerId);

    // Support touch / mouse client coordinates
    let clientX = e.clientX;
    let clientY = e.clientY;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }

    const currentSticker = placedStickers.find(s => s.id === stickerId);
    if (!currentSticker) return;

    dragState.current = {
      isDragging: true,
      action,
      id: stickerId,
      startX: clientX,
      startY: clientY,
      initX: currentSticker.x,
      initY: currentSticker.y,
      initRot: currentSticker.rotation,
      initScale: currentSticker.scale
    };
  };

  const onPointerMove = (e: any) => {
    if (activeMode === "draw") {
      draw(e);
      return;
    }
    if (!dragState.current.isDragging || !dragState.current.id || !containerRef.current) return;

    let clientX = e.clientX;
    let clientY = e.clientY;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const scaleX = dim.w / rect.width;
    const scaleY = dim.h / rect.height;

    const dx = (clientX - dragState.current.startX) * scaleX;
    const dy = (clientY - dragState.current.startY) * scaleY;
    const currentSticker = placedStickers.find(s => s.id === dragState.current.id);
    if (!currentSticker) return;

    if (dragState.current.action === 'move') {
      setPlacedStickers((prev) =>
        prev.map((s) =>
          s.id === dragState.current.id
            ? { ...s, x: dragState.current.initX + dx, y: dragState.current.initY + dy }
            : s
        )
      );
    } else if (dragState.current.action === 'rotate') {
      const { x: curX, y: curY } = getCoordinates(e);
      const centerX = dragState.current.initX;
      const centerY = dragState.current.initY;

      let angle = Math.atan2(curY - centerY, curX - centerX) * 180 / Math.PI;
      angle += 90; // offset because rotate knob is at the top center

      setPlacedStickers(prev => prev.map(s => s.id === dragState.current.id ? { ...s, rotation: angle } : s));
    } else if (dragState.current.action === 'scale') {
      const { x: curX, y: curY } = getCoordinates(e);
      const centerX = dragState.current.initX;
      const centerY = dragState.current.initY;
      const dist = Math.sqrt(Math.pow(curX - centerX, 2) + Math.pow(curY - centerY, 2));

      const { x: startCanvasX, y: startCanvasY } = getCoordinates({ clientX: dragState.current.startX, clientY: dragState.current.startY });
      const startDist = Math.sqrt(Math.pow(startCanvasX - centerX, 2) + Math.pow(startCanvasY - centerY, 2));

      const ratio = dist / (startDist || 1);

      setPlacedStickers(prev => prev.map(s => s.id === dragState.current.id ? { ...s, scale: dragState.current.initScale * ratio } : s));
    }
  };

  const onPointerUp = () => {
    if (activeMode === "draw") {
      stopDrawing();
      return;
    }
    dragState.current.isDragging = false;
    dragState.current.id = null;
  };

  const deleteSelectedSticker = () => {
    setPlacedStickers(prev => prev.filter(s => s.id !== selectedStickerId));
    setSelectedStickerId(null);
  };

  // Finalizer Engine
  const handleFinish = async () => {
    if (!baseImage || !canvasRef.current || isRenderingVideo) return;
    setIsRenderingVideo(true);

    try {
      const storedTemplatesJSON = localStorage.getItem(`templates_${canvasType}`);
      const frames = storedTemplatesJSON ? JSON.parse(storedTemplatesJSON).find((t: any) => t.id.toString() === templateId)?.frames || [] : [];
      let liveVideos: Blob[] | null = null;
      try {
        liveVideos = await localforage.getItem<Blob[]>("liveVideos");
      } catch (e) {
        console.warn("Failed to get liveVideos", e);
      }

      const videoElements: HTMLVideoElement[] = [];

      if (liveVideos && liveVideos.length > 0) {
        for (const blob of liveVideos) {
          if (blob) {
            const url = URL.createObjectURL(blob);
            const vid = document.createElement("video");
            vid.src = url;
            vid.muted = true;
            vid.loop = true;
            vid.playsInline = true;
            await new Promise<void>((resolve) => {
              vid.onloadedmetadata = () => resolve();
              vid.onerror = () => resolve();
            });
            videoElements.push(vid);
          } else {
            videoElements.push(document.createElement("video"));
          }
        }
      }

      const finalCanvas = document.createElement('canvas');
      finalCanvas.width = dim.w;
      finalCanvas.height = dim.h;
      const ctx = finalCanvas.getContext('2d');
      if (!ctx) throw new Error("No context");

      const baseImg = new Image();
      await new Promise<void>((resolve) => { baseImg.onload = () => resolve(); baseImg.onerror = () => resolve(); baseImg.src = baseImage; });

      const rawTemplateImg = new Image();
      let hasTemplateImg = false;
      const templateObj = (storedTemplatesJSON && frames.length > 0) ? JSON.parse(storedTemplatesJSON).find((t: any) => t.id.toString() === templateId) : null;
      if (templateObj?.template_path) {
        await new Promise<void>((resolve) => {
          rawTemplateImg.crossOrigin = "anonymous";
          rawTemplateImg.onload = () => { hasTemplateImg = true; resolve(); };
          rawTemplateImg.onerror = () => resolve();
          let fullPath = templateObj.template_path;
          if (!fullPath.startsWith('http')) {
            const cleanBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
            const cleanPath = fullPath.startsWith("/") ? fullPath.slice(1) : fullPath;
            fullPath = `${cleanBaseUrl}/storage/${cleanPath}`;
          }
          rawTemplateImg.src = `/api/image-proxy?url=${encodeURIComponent(fullPath)}`;
        });
      }

      const stickerImages = await Promise.all(placedStickers.map(async (st) => {
        return new Promise<{ img: HTMLImageElement, st: any }>((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ img, st });
          img.onerror = () => resolve({ img: new Image(), st });
          img.src = st.url;
        });
      }));

      const finishStaticImage = () => {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, dim.w, dim.h);
        ctx.drawImage(baseImg, 0, 0);
        for (const { img, st } of stickerImages) {
          if (img.src) {
            ctx.save();
            ctx.translate(st.x, st.y);
            ctx.rotate((st.rotation * Math.PI) / 180);
            ctx.scale(st.scale, st.scale);
            const drawW = 300;
            const drawH = (200 / img.width) * img.height;
            ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
            ctx.restore();
          }
        }
        if (canvasRef.current) ctx.drawImage(canvasRef.current, 0, 0);

        const finalRenderData = ctx.canvas.toDataURL("image/jpeg", 0.98);
        localStorage.setItem("finalRenderImage", finalRenderData);
        router.push(`/print?kanvas=${canvasType}&template=${templateId}`);
      };

      if (videoElements.some(v => v.src)) {
        let options: any = { mimeType: 'video/webm' };
        if (MediaRecorder.isTypeSupported('video/mp4; codecs="avc1.42E01E"')) {
          options = { mimeType: 'video/mp4; codecs="avc1.42E01E"' };
        } else if (MediaRecorder.isTypeSupported('video/webm; codecs=h264')) {
          options = { mimeType: 'video/webm; codecs=h264' };
        }
        // Hindari VP9 untuk mencegah beban berat pada CPU mesin lama

        const stream = finalCanvas.captureStream(30);
        const recorder = new MediaRecorder(stream, options);
        const chunks: BlobPart[] = [];

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = async () => {
          const finalBlob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
          await localforage.setItem("finalLiveVideo", 
            finalBlob);
          videoElements.forEach(v => v.src && URL.revokeObjectURL(v.src));
          finishStaticImage();
        };

        recorder.start();
        videoElements.forEach(v => {
          if (v.src) {
            v.currentTime = 0;
            v.play().catch(() => { });
          }
        });

        const startTime = Date.now();
        const duration = 6000;

        const renderLoop = () => {
          const elapsed = Date.now() - startTime;
          setLoadingProgress(Math.min(99, Math.round((elapsed / duration) * 100)));

          if (elapsed > duration) {
            setLoadingProgress(100);
            recorder.stop();
            return;
          }

          // 1. Gambar Base Statis (untuk background dan pinggiran aslinya)
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, dim.w, dim.h);
          ctx.drawImage(baseImg, 0, 0);

          // 2. Gambar Video berjalan yang menutupi base image di titik frames
          for (let i = 0; i < videoElements.length; i++) {
            const vid = videoElements[i];
            const fr = frames[i];
            if (vid.src && fr) {
              const x = parseInt(fr.x, 10);
              const y = parseInt(fr.y, 10);
              const fw = parseInt(fr.width, 10);
              const fh = parseInt(fr.height, 10);
              const angle = fr.angle ? parseFloat(fr.angle) : 0;

              // Hardware crop zoom to hide EOS Webcam Utility black bars
              const CAMERA_ZOOM = 1.08;
              const cropW = vid.videoWidth / CAMERA_ZOOM;
              const cropH = vid.videoHeight / CAMERA_ZOOM;
              const cropX = (vid.videoWidth - cropW) / 2;
              const cropY = (vid.videoHeight - cropH) / 2;

              const vrRatio = cropW / cropH;
              const frRatio = fw / fh;

              let sx = cropX, sy = cropY, sw = cropW, sh = cropH;
              if (vrRatio > frRatio) {
                sw = cropH * frRatio;
                sx = cropX + (cropW - sw) / 2;
              } else {
                sh = cropW / frRatio;
                sy = cropY + (cropH - sh) / 2;
              }

              try {
                // Flip video horizontally agar sesuai dengan foto yang sudah di-mirror and apply rotation
                ctx.save();
                ctx.translate(x + fw / 2, y + fh / 2);
                ctx.rotate((angle * Math.PI) / 180);
                ctx.scale(-1, 1);
                ctx.drawImage(vid, sx, sy, sw, sh, -fw / 2, -fh / 2, fw, fh);
                ctx.restore();
              } catch (e) { }
            }
          }

          // 3. Tumpuk kembali dengan template orisinal mentah (yang berlubang transparan)
          // Supaya video tadi tertutup rapi oleh garis tepi template
          if (hasTemplateImg) {
            ctx.drawImage(rawTemplateImg, 0, 0, dim.w, dim.h);
          }

          // 4. Stiker
          for (const { img, st } of stickerImages) {
            if (img.src) {
              ctx.save();
              ctx.translate(st.x, st.y);
              ctx.rotate((st.rotation * Math.PI) / 180);
              ctx.scale(st.scale, st.scale);
              const drawW = 300;
              const drawH = (200 / img.width) * img.height;
              ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
              ctx.restore();
            }
          }

          if (canvasRef.current) ctx.drawImage(canvasRef.current, 0, 0);

          animationFrameRef.current = requestAnimationFrame(renderLoop);
        };
        renderLoop();
      } else {
        finishStaticImage();
      }
    } catch (err) {
      console.error(err);
      setIsRenderingVideo(false);
    }
  };

  if (isLoading || !baseImage) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-[#f15a09] gap-4">
        <div className="w-16 h-16 border-8 border-white border-t-transparent rounded-full animate-spin"></div>
        <p className={`${mochiyPopOne.className} text-white text-xl animate-pulse`}>MENYATUKAN DATA...</p>
        <div className="bg-white/20 w-64 h-2 rounded-full overflow-hidden mt-4 border border-white/30">
           <div className="bg-white h-full transition-all duration-300" style={{ width: `${loadingProgress}%` }}></div>
        </div>
        <p className="text-white font-black text-2xl">{loadingProgress}%</p>
      </div>
    );
  }

  const colors = ["#ffffff", "#000000", "#ff3b30", "#ff9500", "#ffd60a", "#34c759", "#007aff", "#5856d6", "#ff2d55"];

  return (
    <div
      className="relative h-screen w-full overflow-hidden bg-[#f15a09] font-sans text-slate-900 flex flex-col p-2 sm:p-3"
      onMouseMove={onPointerMove}
      onMouseUp={onPointerUp}
      onMouseLeave={onPointerUp}
      onTouchMove={onPointerMove}
      onTouchEnd={onPointerUp}
      onTouchCancel={onPointerUp}
    >
      <div className="relative flex-1 flex flex-col border-[4px] border-white rounded-[30px] overflow-hidden bg-[#f15a09] min-h-0">
        
        <header className="relative z-10 flex items-center justify-between px-5 py-2 shrink-0">
          <h2 className={`${mochiyPopOne.className} text-white text-base sm:text-lg uppercase tracking-widest drop-shadow-md`}>
            PERSONALISASI
          </h2>

          <div className="flex items-center gap-2 bg-white/20 backdrop-blur-xl px-4 py-1.5 rounded-full border border-white/40 shadow-lg">
             <div className={`w-2 h-2 rounded-full bg-white ${timeLeft <= 20 ? 'animate-ping' : 'animate-pulse'}`}></div>
             <span className="text-white font-black tabular-nums tracking-widest text-base">
               {formatTime(timeLeft)}
             </span>
          </div>
        </header>

        <main className="flex-1 flex flex-col gap-3 px-4 pb-3 min-h-0 overflow-hidden">

          <div className="flex-1 flex flex-row gap-4 min-h-0 overflow-hidden">

            <div className="flex-[1.65] flex flex-col min-h-0 min-w-0 gap-2">

              <h2 className={`${mochiyPopOne.className} text-white text-sm uppercase tracking-widest text-center shrink-0 drop-shadow-md`}>
                HASIL FOTO
              </h2>

          <div className="flex-1 min-h-0 bg-white rounded-[20px] shadow-2xl relative overflow-hidden border-3 border-white flex flex-col">
            
            <div 
              ref={containerRef}
              className="flex-1 flex items-center justify-center p-4 overflow-hidden select-none relative"
              onMouseDown={(e) => { if (activeMode === "draw") startDrawing(e); else if (e.target === e.currentTarget) setSelectedStickerId(null); }}
              onTouchStart={(e) => { if (activeMode === "draw") startDrawing(e); else if (e.target === e.currentTarget) setSelectedStickerId(null); }}
            >
               <div className="relative shadow-2xl rounded-lg overflow-hidden shrink-0 bg-white" style={{ height: '100%', aspectRatio: `${dim.w} / ${dim.h}` }}>
                  <img src={baseImage} alt="Base" className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none" draggable={false} />
                  
                  {/* STICKER LAYER */}
                  <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden" 
                       style={{ width: dim.w, height: dim.h, transformOrigin: 'top left', transform: `scale(${containerRef.current ? containerRef.current.clientHeight / dim.h : 1})` }}>
                    {placedStickers.map(st => (
                      <div
                        key={st.id}
                        className={`absolute inline-block pointer-events-auto origin-center transition-shadow ${selectedStickerId === st.id ? 'ring-[12px] ring-[#f15a09] ring-offset-8 ring-offset-transparent' : 'drop-shadow-md hover:drop-shadow-xl'}`}
                        style={{
                          left: st.x,
                          top: st.y,
                          width: Math.max(300 * st.scale, 120),
                          transform: `translate(-50%, -50%) rotate(${st.rotation}deg)`,
                        }}
                        onMouseDown={(e) => onStickerPointerDown(e, st.id, 'move')}
                        onTouchStart={(e) => onStickerPointerDown(e, st.id, 'move')}
                      >
                        <img src={st.url} alt="Sticker" draggable={false} className="object-contain pointer-events-none w-full" />
                        {selectedStickerId === st.id && (
                          <>
                            <div
                              className="absolute -top-[140px] left-1/2 -translate-x-1/2 w-[120px] h-[120px] bg-white border-[10px] border-[#f15a09] rounded-full flex items-center justify-center cursor-alias shadow-2xl text-[60px] text-[#f15a09] font-black hover:scale-110 active:scale-90 transition-transform"
                              onMouseDown={(e) => onStickerPointerDown(e, st.id, 'rotate')}
                              onTouchStart={(e) => onStickerPointerDown(e, st.id, 'rotate')}
                            >↻</div>
                            <div
                              className="absolute -bottom-[60px] -right-[60px] w-[120px] h-[120px] bg-white border-[10px] border-[#f15a09] rounded-full flex items-center justify-center cursor-nwse-resize shadow-2xl text-[60px] text-[#f15a09] font-black hover:scale-110 active:scale-90 transition-transform"
                              onMouseDown={(e) => onStickerPointerDown(e, st.id, 'scale')}
                              onTouchStart={(e) => onStickerPointerDown(e, st.id, 'scale')}
                            >⤡</div>
                            <div
                              className="absolute -top-[60px] -right-[60px] w-[120px] h-[120px] bg-rose-50 border-[10px] border-rose-500 rounded-full flex items-center justify-center cursor-pointer shadow-2xl text-[60px] text-rose-500 font-black hover:scale-110 active:scale-90 transition-transform"
                              onMouseDown={(e) => { e.stopPropagation(); deleteSelectedSticker(); }}
                              onTouchStart={(e) => { e.stopPropagation(); deleteSelectedSticker(); }}
                            >✕</div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>

                  <canvas
                    ref={canvasRef}
                    width={dim.w}
                    height={dim.h}
                    className={`absolute inset-0 w-full h-full touch-none z-30 ${activeMode === "draw" ? "cursor-crosshair pointer-events-auto" : "pointer-events-none"}`}
                  />
               </div>
            </div>
          </div>

            </div>



            <div className="flex-1 flex flex-col min-h-0 min-w-0 gap-2">

              <h2 className={`${mochiyPopOne.className} text-white text-sm uppercase tracking-widest text-center shrink-0 drop-shadow-md`}>
                ALAT EDIT
              </h2>

          <div className="flex-1 min-h-0 bg-white rounded-[20px] shadow-2xl p-3 flex flex-col gap-3 overflow-y-auto border-3 border-white custom-scrollbar">
             
             {/* Mode Selector Header Inside Sidebar */}
             <div className="bg-slate-50 p-1 rounded-full flex gap-1 border border-slate-100 shadow-inner shrink-0 w-full">
                <button 
                  onClick={() => setActiveMode("draw")}
                  className={`flex-1 py-2 rounded-full font-black text-[9px] tracking-widest transition-all uppercase ${activeMode === "draw" ? "bg-[#f15a09] text-white shadow-lg" : "text-slate-400 hover:text-[#f15a09]"}`}
                >
                  CORETAN
                </button>
                <button 
                  onClick={() => setActiveMode("sticker")}
                  className={`flex-1 py-2 rounded-full font-black text-[9px] tracking-widest transition-all uppercase ${activeMode === "sticker" ? "bg-[#f15a09] text-white shadow-lg" : "text-slate-400 hover:text-[#f15a09]"}`}
                >
                  STIKER
                </button>
             </div>

             {activeMode === "draw" ? (
               <div className="flex flex-col flex-1 gap-3 animate-in slide-in-from-bottom-10 duration-500 w-full min-h-0">
                  <h4 className={`${mochiyPopOne.className} text-[#f15a09] text-[10px] uppercase tracking-widest`}>PILIH WARNA</h4>
                  <div className="flex flex-wrap gap-2">
                    {colors.map(c => (
                      <button 
                        key={c} 
                        onClick={() => setColor(c)} 
                        className={`w-9 h-9 rounded-full transition-all duration-300 border-3 shadow-sm ${color === c ? "border-[#f15a09] scale-110 shadow-orange-100" : "border-slate-50 opacity-80"}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>

                  <h4 className={`${mochiyPopOne.className} text-[#f15a09] text-[10px] uppercase tracking-widest`}>UKURAN KUAS</h4>
                  <div className="flex gap-3">
                    {[6, 12, 24].map(size => (
                      <button key={size} onClick={() => setBrushSize(size)} className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${brushSize === size ? "bg-orange-50 text-[#f15a09] border-3 border-[#f15a09]" : "bg-slate-50 text-slate-300 border-3 border-slate-50"}`}>
                        <div className="bg-current rounded-full" style={{ width: size/2 + 'px', height: size/2 + 'px' }} />
                      </button>
                    ))}
                  </div>

                  <div className="mt-auto grid grid-cols-2 gap-2 pt-1">
                    <button onClick={handleUndo} disabled={history.length <= 1} className="py-3 bg-slate-50 text-slate-400 rounded-2xl font-black text-xs uppercase tracking-widest border-2 border-slate-100 disabled:opacity-30 flex flex-col items-center gap-1 hover:bg-slate-100 transition-colors">
                       <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
                       UNDO
                    </button>
                    <button onClick={handleClear} disabled={history.length <= 1} className="py-3 bg-rose-50 text-rose-500 rounded-2xl font-black text-xs uppercase tracking-widest border-2 border-rose-100 disabled:opacity-30 flex flex-col items-center gap-1 hover:bg-rose-100 transition-colors">
                       <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                       HAPUS
                    </button>
                  </div>
               </div>
             ) : (
               <div className="flex flex-col flex-1 gap-3 animate-in slide-in-from-bottom-10 duration-500 w-full min-h-0">
                  <h4 className={`${mochiyPopOne.className} text-[#f15a09] text-[10px] uppercase tracking-widest`}>KOLEKSI STIKER</h4>
                  <div className="flex-1 overflow-y-auto grid grid-cols-2 gap-3 custom-scrollbar min-h-0" style={{ scrollbarWidth: "none" }}>
                    {stickersList.map((st) => {
                      let fullPath = st.image_path;
                      if (!fullPath.startsWith('http')) {
                        const cleanBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
                        const cleanPath = fullPath.startsWith("/") ? fullPath.slice(1) : fullPath;
                        fullPath = `${cleanBaseUrl}/storage/${cleanPath}`;
                      }
                      const proxyUrl = `/api/image-proxy?url=${encodeURIComponent(fullPath)}`;
                      return (
                        <img key={st.id} src={proxyUrl} alt={st.name} onClick={() => addSticker(st)}
                          className="w-full h-28 object-contain bg-slate-50 border-4 border-white rounded-2xl p-2 cursor-pointer shadow-sm hover:border-[#f15a09] transition-all active:scale-95" />
                      );
                    })}
                  </div>
                  {selectedStickerId && (
                     <button onClick={deleteSelectedSticker} className="py-3 mt-2 bg-rose-500 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg flex items-center justify-center gap-2 shrink-0 hover:bg-rose-600 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                        HAPUS STIKER TERPILIH
                     </button>
                  )}
               </div>
             )}
          </div>

            </div>

          </div>

        </main>

        <footer className="shrink-0 flex items-center justify-center gap-3 px-6 py-3">
           <button
             onClick={() => {
               const storedTemplatesJSON = localStorage.getItem(`templates_${canvasType}`);
               let frameCount = 4;
               if (storedTemplatesJSON) {
                 const tpls = JSON.parse(storedTemplatesJSON);
                 const t = tpls.find((x: any) => x.id.toString() === templateId);
                 if (t) frameCount = t.frame_count;
               }
               router.push(`/camera?kanvas=${canvasType}&template=${templateId}&frames=${frameCount}&time=${timeLeft}`);
             }}
             className="rounded-full border-2 border-white px-6 py-2.5 text-xs font-black uppercase tracking-widest text-white transition-colors hover:bg-white/10"
           >
             FOTO ULANG
           </button>
           <button
             id="btn-finish"
             onClick={() => {
               setLoadingProgress(0);
               handleFinish();
             }}
             disabled={isRenderingVideo}
             className="rounded-full bg-white px-10 py-2.5 text-sm font-black uppercase tracking-widest text-[#f15a09] shadow-xl transition-transform hover:scale-[1.03] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-70 select-none"
           >
             {isRenderingVideo ? "SEDANG MERENDER..." : "LANJUT CETAK"}
           </button>
        </footer>
      </div>

      {showWarning && (
        <div className="fixed top-28 left-1/2 -translate-x-1/2 z-[100] bg-white text-[#f15a09] px-12 py-6 rounded-full shadow-2xl border-4 border-[#f15a09] animate-bounce">
          <span className={`${mochiyPopOne.className} text-2xl uppercase`}>Sisa 1 Menit!</span>
        </div>
      )}

      {showTimeoutAlert && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-xl animate-in fade-in duration-500">
             <div className="bg-white rounded-[40px] p-12 w-full max-w-md shadow-2xl border-[8px] border-[#f15a09] flex flex-col items-center text-center animate-in zoom-in-95 duration-500">
                <div className="w-24 h-24 bg-orange-100 text-[#f15a09] rounded-full flex items-center justify-center mb-8 animate-bounce">
                   <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
                </div>
                <h3 className={`${mochiyPopOne.className} text-3xl text-slate-900 mb-4 uppercase`}>SESI BERAKHIR</h3>
                <p className="font-bold text-slate-500 text-lg leading-relaxed mb-4">Mohon maaf, waktu sesi Anda telah habis.</p>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden mt-4">
                   <div className="bg-[#f15a09] h-full animate-[ses-progress_3.5s_linear_forwards]"></div>
                </div>
                <p className="text-xs text-slate-400 mt-4 uppercase font-black tracking-widest">Mencetak otomatis...</p>
             </div>
          </div>
      )}

      {isRenderingVideo && (
          <div className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-[#f15a09] animate-in fade-in duration-300">
             <div className="w-24 h-24 border-[12px] border-white border-t-transparent rounded-full animate-spin mb-8"></div>
             <h2 className={`${mochiyPopOne.className} text-4xl text-white mb-4 uppercase tracking-tighter`}>MERENDER HASIL...</h2>
             <div className="w-80 h-4 bg-white/20 rounded-full overflow-hidden border-2 border-white/50 mb-4 shadow-inner">
                <div className="bg-white h-full transition-all duration-300 shadow-[0_0_20px_rgba(255,255,255,0.5)]" style={{ width: `${loadingProgress}%` }}></div>
             </div>
             <p className="text-white text-5xl font-black">{loadingProgress}%</p>
             <p className="text-white/70 text-sm font-bold uppercase tracking-widest mt-8 animate-pulse">Mohon tunggu sebentar, sedang memproses video & stiker</p>
          </div>
      )}

      <style jsx global>{`
        @keyframes ses-progress {
          from { width: 100%; }
          to { width: 0%; }
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 0px;
          display: none;
        }
      `}</style>
    </div>
  );
}

export default function RenderPage() {
  return (
    <Suspense fallback={
      <div className="h-screen w-full flex items-center justify-center bg-[#f15a09]">
        <div className="w-16 h-16 border-8 border-white border-t-transparent rounded-full animate-spin"></div>
      </div>
    }>
      <RenderContent />
    </Suspense>
  );
}
