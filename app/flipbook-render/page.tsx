"use client";

import React, { useState, useEffect, useRef, Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import localforage from "localforage";
import { Mochiy_Pop_One } from "next/font/google";

const mochiyPopOne = Mochiy_Pop_One({
  subsets: ["latin"],
  weight: "400",
});

function FlipbookRenderContent() {
  function getFilterStyle(editState?: any) {
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

  const router = useRouter();
  const searchParams = useSearchParams();
  const canvasType = searchParams.get("kanvas") || "flipbook";
  const templateId = searchParams.get("template") || "1";
  const [initialTime, setInitialTime] = useState(120);
  useEffect(() => {
    const savedTimeout = localStorage.getItem("sessionTimeout");
    if (savedTimeout) setInitialTime(Number(searchParams.get("time")) || parseInt(savedTimeout, 10));
  }, [searchParams]);

  // Basic States
  const [isLoading, setIsLoading] = useState(true);
  const [baseImage, setBaseImage] = useState<string | null>(null);
  
  const [timeLeft, setTimeLeft] = useState(initialTime);
  useEffect(() => {
    setTimeLeft(initialTime);
  }, [initialTime]);
  const [showWarning, setShowWarning] = useState(false);
  const [dim, setDim] = useState({ w: 1080, h: 1920 });
  const [baseUrl, setBaseUrl] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [showFlipbookPreview, setShowFlipbookPreview] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [templateImgUrl, setTemplateImgUrl] = useState<string | null>(null);
  const [allPreviewFrames, setAllPreviewFrames] = useState<string[]>([]);
  const [selectedFrameIndex, setSelectedFrameIndex] = useState(0);
  
  // Data for each of the 20 frames
  const [framesData, setFramesData] = useState<any[]>([]); // { stickers: [], doodles: string }
  
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const fetchVideo = async () => {
      const blob = await localforage.getItem<Blob>("flipbook_video");
      if (blob) {
        setVideoUrl(URL.createObjectURL(blob));
      }
    };
    fetchVideo();
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, []);

  // Drawing Canvas Logic
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewScale, setPreviewScale] = useState(1);
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
    const processTemplateAndCover = async () => {
      try {
        const storedCover = localStorage.getItem("flipbook_cover");
        const storedCoverEdit = localStorage.getItem("flipbook_coverEdit");
        const storedTemplatesJSON = localStorage.getItem("templates");
        const storedStickersJSON = localStorage.getItem("stickers");
        const storedBaseUrl = localStorage.getItem("templates_base_url") || "";

        setBaseUrl(storedBaseUrl);
        if (storedStickersJSON) {
          setStickersList(JSON.parse(storedStickersJSON));
        }

        if (!storedCover || !storedTemplatesJSON) {
          router.push("/template?kanvas=flipbook");
          return;
        }

        const templates: any[] = JSON.parse(storedTemplatesJSON);
        const template = templates.find((t) => t.id.toString() === templateId);

        if (!template) {
          router.push("/template?kanvas=flipbook");
          return;
        }

        const tw = parseInt(template.image_width, 10) || 1080;
        const th = parseInt(template.image_height, 10) || 1920;
        setDim({ w: tw, h: th });

        // Setup Offscreen Canvas
        const offCanvas = document.createElement("canvas");
        offCanvas.width = tw;
        offCanvas.height = th;
        const ctx = offCanvas.getContext("2d");
        if (!ctx) return;

        // Background Putih
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, tw, th);

        // Load Cover Image & Apply CSS Filters using Canvas Filter
        const coverImg = await new Promise<HTMLImageElement>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.src = storedCover;
        });

        if (storedCoverEdit) {
           const editState = JSON.parse(storedCoverEdit);
           ctx.filter = getFilterStyle(editState);
        }

        // Draw Cover Image ke dalam Frame(s)
        const frames = template.frames || [];
        for (let i = 0; i < frames.length; i++) {
          const fr = frames[i];
          const fx = parseInt(fr.x, 10);
          const fy = parseInt(fr.y, 10);
          const fw = parseInt(fr.width, 10);
          const fh = parseInt(fr.height, 10);

          const imgRatio = coverImg.width / coverImg.height;
          const frameRatio = fw / fh;

          let sx = 0, sy = 0, sw = coverImg.width, sh = coverImg.height;
          if (imgRatio > frameRatio) {
            sw = coverImg.height * frameRatio;
            sx = (coverImg.width - sw) / 2;
          } else {
            sh = coverImg.width / frameRatio;
            sy = (coverImg.height - sh) / 2;
          }
          ctx.drawImage(coverImg, sx, sy, sw, sh, fx, fy, fw, fh);
        }

        ctx.filter = "none";

        // Load Template Image Once
        let tImgObj: HTMLImageElement | null = null;
        if (template.template_path) {
          let fullPath = template.template_path;
          if (!fullPath.startsWith('http')) {
            const cleanBaseUrl = storedBaseUrl.endsWith("/") ? storedBaseUrl.slice(0, -1) : storedBaseUrl;
            const cleanPath = fullPath.startsWith("/") ? fullPath.slice(1) : fullPath;
            fullPath = `${cleanBaseUrl}/storage/${cleanPath}`;
          }
          const finalTemplateUrl = `/api/image-proxy?url=${encodeURIComponent(fullPath)}`;
          setTemplateImgUrl(finalTemplateUrl);

          tImgObj = await new Promise<HTMLImageElement | null>((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = finalTemplateUrl;
          });
        }

        // Draw Cover
        if (tImgObj) {
            ctx.drawImage(tImgObj, 0, 0, tw, th);
        }

        // 3. Generate Cover Image (Template + Photo)
        const finalCoverData = offCanvas.toDataURL("image/jpeg", 0.95);
        setBaseImage(finalCoverData);

        // 4. Load all extracted frames for the filmstrip & merge with template
        const storedFramesJSON = localStorage.getItem("flipbook_frames");
        const rawExtractedFrames: string[] = storedFramesJSON ? JSON.parse(storedFramesJSON) : [];
        const templatedFrames: string[] = [];
        
        // Loop through each raw frame and merge with template
        for(const rawFrame of rawExtractedFrames) {
            if (!rawFrame || rawFrame.length < 100) {
              // Skip empty/corrupt frame data — use previous good frame or white
              console.warn("[FlipbookRender] Skipping empty/corrupt raw frame");
              templatedFrames.push(templatedFrames.length > 0 ? templatedFrames[templatedFrames.length - 1] : offCanvas.toDataURL("image/jpeg", 0.95));
              continue;
            }
            const fImg = await new Promise<HTMLImageElement>((resolve) => {
              const img = new Image();
              img.onload = () => resolve(img);
              img.onerror = () => {
                console.warn("[FlipbookRender] Failed to load raw frame, using fallback");
                resolve(img); // resolve with empty img, drawImage will just be a no-op
              };
              img.src = rawFrame;
              // Safety timeout — don't hang forever on a bad frame
              setTimeout(() => resolve(img), 3000);
            });
            ctx.clearRect(0, 0, tw, th);
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, tw, th);
            // Only draw if the image actually loaded
            if (fImg.naturalWidth > 0) {
              ctx.drawImage(fImg, 0, 0, tw, th);
            }
            if (tImgObj) ctx.drawImage(tImgObj, 0, 0, tw, th);
            templatedFrames.push(offCanvas.toDataURL("image/jpeg", 0.95));
        }
        
        const fullList = [finalCoverData, ...templatedFrames];
        setAllPreviewFrames(fullList);

        // Initialize empty individual data for 20 frames
        const initialData = fullList.map((_, idx) => ({
          stickers: [],
          doodle: null
        }));
        setFramesData(initialData);

        setIsLoading(false);

        // Simulasi Canvas Ref untuk History Note
        setTimeout(() => {
          if (canvasRef.current) {
            setHistory([canvasRef.current.toDataURL()]);
          }
        }, 100);

      } catch (e) {
        console.error(e);
        router.push("/template?kanvas=flipbook");
      }
    };
    processTemplateAndCover();
  }, [router, templateId]);

  // -- Timer Engine 
  useEffect(() => {
    if (isLoading) return;
    const storedExpiry = localStorage.getItem("session_expiry");
    let expiry = storedExpiry ? parseInt(storedExpiry, 10) : 0;
    
    if (!expiry) return;

    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiry - Date.now()) / 1000));
      setTimeLeft(remaining);

      if (remaining <= 0) {
        clearInterval(timer);
        document.getElementById("btn-finish")?.click();
      }

      if (remaining === 60 && !showWarning) {
        setShowWarning(true);
        setTimeout(() => setShowWarning(false), 5000);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [showWarning, isLoading]);

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  useEffect(() => {
    const el = previewRef.current;
    if (!el || isLoading) return;

    const updateScale = () => {
      const rect = el.getBoundingClientRect();
      if (rect.height > 0 && dim.h > 0) {
        setPreviewScale(rect.height / dim.h);
      }
    };

    updateScale();
    const ro = new ResizeObserver(updateScale);
    ro.observe(el);
    window.addEventListener("resize", updateScale);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateScale);
    };
  }, [dim.w, dim.h, isLoading, selectedFrameIndex, showFlipbookPreview]);

  const previewFilter = useMemo(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("flipbook_coverEdit");
      if (stored) return getFilterStyle(JSON.parse(stored));
    }
    return "none";
  }, []);

  const videoPreviewFilter = useMemo(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("flipbook_videoEdit");
      if (stored) return getFilterStyle(JSON.parse(stored));
    }
    return "none";
  }, []);

  // -- Math Helpers
  const getCoordinates = (e: any) => {
    const target = previewRef.current ?? containerRef.current;
    if (!target) return { x: 0, y: 0 };
    const rect = target.getBoundingClientRect();
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
      // Update state immediately
      setFramesData(prev => prev.map((f, i) => i === selectedFrameIndex ? { ...f, doodle: blankState } : f));
    }
  };

  const switchFrame = (newIdx: number) => {
    if (newIdx === selectedFrameIndex) return;

    // 1. Save current frame data
    const currentDoodle = canvasRef.current?.toDataURL() || null;
    const currentStickers = [...placedStickers];
    
    setFramesData(prev => prev.map((f, i) => 
      i === selectedFrameIndex ? { stickers: currentStickers, doodle: currentDoodle } : f
    ));

    // 2. Load next frame data
    const nextData = framesData[newIdx];
    setSelectedFrameIndex(newIdx);
    setPlacedStickers(nextData.stickers || []);
    setSelectedStickerId(null);
    
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, dim.w, dim.h);
      if (nextData.doodle) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0);
        img.src = nextData.doodle;
        setHistory([nextData.doodle]);
      } else {
        setHistory([]);
      }
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
    const target = previewRef.current ?? containerRef.current;
    if (!dragState.current.isDragging || !dragState.current.id || !target) return;

    let clientX = e.clientX;
    let clientY = e.clientY;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }

    const rect = target.getBoundingClientRect();
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
    if (!baseImage || !canvasRef.current || isProcessing) return;
    setIsProcessing(true);

    // ── Sync active frame's stickers & doodle into framesData before export ──
    // switchFrame() only saves when switching AWAY, so the currently active
    // frame's placedStickers / canvas doodle may not yet be in framesData.
    const currentDoodle = canvasRef.current.toDataURL();
    const currentStickers = [...placedStickers];
    const syncedFramesData = framesData.map((f: any, i: number) =>
      i === selectedFrameIndex
        ? { stickers: currentStickers, doodle: currentDoodle }
        : f
    );

    try {
      const storedTemplatesJSON = localStorage.getItem("templates");
      const templates = storedTemplatesJSON ? JSON.parse(storedTemplatesJSON) : [];
      const templateObj = templates.find((t: any) => t.id.toString() === templateId);
      const frames = templateObj?.frames || [];

      // Validasi frame_id untuk keperluan print
      const firstFrameId = frames[0]?.id || "1";

      const finalCanvas = document.createElement('canvas');
      finalCanvas.width = dim.w;
      finalCanvas.height = dim.h;
      const ctx = finalCanvas.getContext('2d');
      if (!ctx) throw new Error("No context");

      // Load Template Transparan Asli
      const rawTemplateImg = new Image();
      let hasTemplateImg = false;
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

      // Load Existing Cover Image (with filter) as baseImg
      const coverImgRendered = new Image();
      await new Promise<void>((resolve) => { 
        coverImgRendered.onload = () => resolve(); 
        coverImgRendered.onerror = () => resolve(); 
        coverImgRendered.src = baseImage; 
      });

      // Load Stickers
      const stickerImages = await Promise.all(placedStickers.map(async (st) => {
        return new Promise<{ img: HTMLImageElement, st: any }>((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ img, st });
          img.onerror = () => resolve({ img: new Image(), st });
          img.src = st.url;
        });
      }));

      // ==========================================
      // STAGE 1: BIKIN GAMBAR/COVER FINAL STATIS
      // ==========================================
      // Collect ALL unique stickers across ALL frames → apply globally to every frame
      const allGlobalStickers: any[] = [];
      const seenStickerIds = new Set<string>();
      for (const fd of syncedFramesData) {
        if (fd?.stickers) {
          for (const st of fd.stickers) {
            if (!seenStickerIds.has(st.id)) {
              seenStickerIds.add(st.id);
              allGlobalStickers.push(st);
            }
          }
        }
      }

      // Pre-load all global sticker images once
      const globalStickerImages = await Promise.all(
        allGlobalStickers.map(async (st: any) => {
          return new Promise<{ img: HTMLImageElement; st: any }>((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ img, st });
            img.onerror = () => resolve({ img: new Image(), st });
            img.src = st.url;
            setTimeout(() => resolve({ img: new Image(), st }), 3000);
          });
        })
      );

      const coverFrameData = syncedFramesData[0] || { stickers: [], doodle: null };

      const finishStaticImage = () => {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, dim.w, dim.h);
        ctx.drawImage(coverImgRendered, 0, 0); 
        
        // Draw ALL global stickers on cover
        for (const { img, st } of globalStickerImages) {
          if (img.src && img.naturalWidth > 0) {
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
        
        // Draw Cover (frame 0) Doodle
        if (coverFrameData.doodle) {
          const dImg = new Image();
          dImg.src = coverFrameData.doodle;
          if (dImg.complete && dImg.naturalWidth > 0) {
            ctx.drawImage(dImg, 0, 0);
          }
        }

        // -- Add sequence number "0" for cover --
        const padding = 30;
        const fontSize = 50;
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        
        const text = "0";
        // Subtle Shadow
        ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
        ctx.shadowBlur = 3;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;
        ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
        ctx.fillText(text, padding, padding);
        // Reset shadow
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        const finalCoverData = ctx.canvas.toDataURL("image/jpeg", 0.98);
        localStorage.setItem("flipbook_final_cover", finalCoverData);
      };

      // ==========================================
      // STAGE 2: RENDER VIDEO DENGAN TEMPLATE
      // ==========================================
      const videoBlob = await localforage.getItem<Blob>("flipbook_video");
      const storedVideoEdit = localStorage.getItem("flipbook_videoEdit");
      let filterStyleStr = "none";
      if (storedVideoEdit) {
           filterStyleStr = getFilterStyle(JSON.parse(storedVideoEdit));
      }

      if (videoBlob) {
        const url = URL.createObjectURL(videoBlob);
        const vid = document.createElement("video");
        vid.src = url;
        vid.muted = true;
        vid.loop = true;
        vid.playsInline = true;

        await new Promise<void>((resolve) => {
          vid.onloadedmetadata = () => resolve();
          vid.onerror = () => resolve();
        });

        const DURATION = 10000; // 10 Detik

        let options: any = { mimeType: 'video/webm' };
        if (MediaRecorder.isTypeSupported('video/mp4; codecs="avc1.42E01E"')) {
          options = { mimeType: 'video/mp4; codecs="avc1.42E01E"' };
        } else if (MediaRecorder.isTypeSupported('video/webm; codecs=h264')) {
          options = { mimeType: 'video/webm; codecs=h264' };
        }
        // Jangan paksakan VP9 agar tidak membebani hardware yang lama

        const stream = finalCanvas.captureStream(30);
        const recorder = new MediaRecorder(stream, options);
        const chunks: BlobPart[] = [];

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = async () => {
          const finalRenderedVideoBlob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
          // OVERWRITE original flipbook_video mapping with this new templated video!
          await localforage.setItem("flipbook_video", finalRenderedVideoBlob);
          URL.revokeObjectURL(url);
          
          finishStaticImage();

          // ==========================================
          // STAGE 3: EXPORT ALL EDITED FRAMES (FOR PRINT)
          // ==========================================
          const exportAllEditedFrames = async () => {
            const editedFramesData: string[] = [];
            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = dim.w;
            tempCanvas.height = dim.h;
            const tctx = tempCanvas.getContext("2d")!;

            const framesToProcess = allPreviewFrames;

            let lastGoodExportFrame: string | null = null;

            for (let i = 0; i < framesToProcess.length; i++) {
              tctx.fillStyle = "#ffffff";
              tctx.fillRect(0, 0, dim.w, dim.h);

              // 1. Draw base frame (already has template + photo)
              const frameSrc = framesToProcess[i];
              if (frameSrc && frameSrc.length > 100) {
                const bImg = await new Promise<HTMLImageElement>((resolve) => {
                  const img = new Image();
                  img.onload = () => resolve(img);
                  img.onerror = () => {
                    console.warn(`[FlipbookRender] Failed to load frame ${i} for export`);
                    resolve(img);
                  };
                  img.src = frameSrc;
                  setTimeout(() => resolve(img), 3000);
                });
                if (bImg.naturalWidth > 0) {
                  tctx.drawImage(bImg, 0, 0);
                } else if (lastGoodExportFrame) {
                  // Use last good frame if current frame failed to load
                  const fallbackImg = await new Promise<HTMLImageElement>((resolve) => {
                    const img = new Image();
                    img.onload = () => resolve(img);
                    img.onerror = () => resolve(img);
                    img.src = lastGoodExportFrame!;
                  });
                  if (fallbackImg.naturalWidth > 0) tctx.drawImage(fallbackImg, 0, 0);
                }
              } else if (lastGoodExportFrame) {
                // Empty frame data — use last good frame
                console.warn(`[FlipbookRender] Frame ${i} data is empty, using fallback`);
                const fallbackImg = await new Promise<HTMLImageElement>((resolve) => {
                  const img = new Image();
                  img.onload = () => resolve(img);
                  img.onerror = () => resolve(img);
                  img.src = lastGoodExportFrame!;
                });
                if (fallbackImg.naturalWidth > 0) tctx.drawImage(fallbackImg, 0, 0);
              }

              // 2. Draw ALL global stickers on every frame
              const frameData = syncedFramesData[i];
              for (const { img: sImg, st } of globalStickerImages) {
                if (sImg.naturalWidth > 0) {
                  tctx.save();
                  tctx.translate(st.x, st.y);
                  tctx.rotate((st.rotation * Math.PI) / 180);
                  tctx.scale(st.scale, st.scale);
                  const dw = 200;
                  const dh = (200 / sImg.width) * sImg.height;
                  tctx.drawImage(sImg, -dw/2, -dh/2, dw, dh);
                  tctx.restore();
                }
              }

              // 3. Draw per-frame doodle
              if (frameData?.doodle) {
                const dImg = await new Promise<HTMLImageElement>((resolve) => {
                  const img = new Image();
                  img.onload = () => resolve(img);
                  img.onerror = () => resolve(img);
                  img.src = frameData.doodle;
                  setTimeout(() => resolve(img), 2000);
                });
                if (dImg.naturalWidth > 0) tctx.drawImage(dImg, 0, 0);
              }

              // -- Add sequence number (0-19) in top left corner --
              const padding = 30;
              const fontSize = 50;
              tctx.font = `bold ${fontSize}px sans-serif`;
              tctx.textAlign = "left";
              tctx.textBaseline = "top";
              
              const text = i.toString();
              // Subtle Shadow
              tctx.shadowColor = "rgba(0, 0, 0, 0.3)";
              tctx.shadowBlur = 3;
              tctx.shadowOffsetX = 1;
              tctx.shadowOffsetY = 1;
              tctx.fillStyle = "rgba(255, 255, 255, 0.5)";
              tctx.fillText(text, padding, padding);
              // Reset shadow
              tctx.shadowColor = "transparent";
              tctx.shadowBlur = 0;
              tctx.shadowOffsetX = 0;
              tctx.shadowOffsetY = 0;

              const exportedFrame = tempCanvas.toDataURL("image/jpeg", 0.98);
              editedFramesData.push(exportedFrame);
              lastGoodExportFrame = exportedFrame;
            }
            await localforage.setItem("flipbook_final_frames", editedFramesData);
          };

          await exportAllEditedFrames();
          
          router.push(`/flipbook-print?kanvas=${canvasType}&template=${templateId}`);
        };

        recorder.start();
        vid.currentTime = 0;
        vid.play().catch(() => {});

        const startTime = Date.now();

        const renderLoop = () => {
          const elapsed = Date.now() - startTime;
          if (elapsed > DURATION) {
            recorder.stop();
            return;
          }

          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, dim.w, dim.h);

          // Gambar video ke dalam SEMUA frame
          for (let i = 0; i < (frames.length || 1); i++) {
             const fr = frames[i] || { x: 0, y: 0, width: dim.w, height: dim.h };
             if (vid.src) {
               const x = parseInt(fr.x, 10);
               const y = parseInt(fr.y, 10);
               const fw = parseInt(fr.width, 10);
               const fh = parseInt(fr.height, 10);

               const vrRatio = vid.videoWidth / vid.videoHeight;
               const frRatio = fw / fh;

               let sx = 0, sy = 0, sw = vid.videoWidth, sh = vid.videoHeight;
               if (vrRatio > frRatio) {
                 sw = vid.videoHeight * frRatio;
                 sx = (vid.videoWidth - sw) / 2;
               } else {
                 sh = vid.videoWidth / frRatio;
                 sy = (vid.videoHeight - sh) / 2;
               }

               try {
                 // Mirror video (horizontal flip) as requested
                 ctx.save();
                 ctx.translate(x + fw, y);
                 ctx.scale(-1, 1);
                 // APPLY FILTER
                 ctx.filter = filterStyleStr;
                 ctx.drawImage(vid, sx, sy, sw, sh, 0, 0, fw, fh);
                 ctx.restore();
               } catch (e) { }
             }
          }

          // Reset filter for stickers/template/doodle
          ctx.filter = "none";

          // Tumpuk template transparan
          if (hasTemplateImg) {
            ctx.drawImage(rawTemplateImg, 0, 0, dim.w, dim.h);
          }

          // Tumpuk Stickers
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

          // Tumpuk Coretan Doodle
          if (canvasRef.current) ctx.drawImage(canvasRef.current, 0, 0);

          animationFrameRef.current = requestAnimationFrame(renderLoop);
        };
        renderLoop();
      } else {
        // Gak Merekam Video kalau ngga ada flipbook_video di storage
        finishStaticImage();
        router.push(`/flipbook-print?kanvas=${canvasType}&template=${templateId}`);
      }

    } catch (err) {
      console.error(err);
      setIsProcessing(false);
    }
  };

  if (isLoading || !baseImage) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-[#f15a09]">
        <div className="w-16 h-16 border-8 border-white border-t-transparent rounded-full animate-spin"></div>
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
      {/* Warning */}
      {showWarning && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-rose-500 text-white px-8 py-4 rounded-full shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-10 duration-500">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
          <span className="font-extrabold tracking-wide">WAKTU TERSISA 1 MENIT!</span>
        </div>
      )}

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

            <div className="flex-[1.55] flex flex-col min-h-0 min-w-0 gap-2">

              <h2 className={`${mochiyPopOne.className} text-white text-sm uppercase tracking-widest text-center shrink-0 drop-shadow-md`}>
                HASIL FLIPBOOK
              </h2>

          <div className="flex-1 min-h-0 bg-white rounded-[20px] shadow-2xl relative overflow-hidden border-3 border-white flex flex-col">
            <div 
              ref={containerRef}
              className="flex-1 flex items-center justify-center p-4 overflow-hidden select-none relative min-h-0 w-full"
              onMouseDown={(e) => { if (activeMode === "draw") startDrawing(e); else if (e.target === e.currentTarget) setSelectedStickerId(null); }}
              onTouchStart={(e) => { if (activeMode === "draw") startDrawing(e); else if (e.target === e.currentTarget) setSelectedStickerId(null); }}
            >
               <div
                 ref={previewRef}
                 className="relative shadow-2xl rounded-lg overflow-hidden shrink-0 bg-slate-100 h-full max-w-full"
                 style={{ aspectRatio: `${dim.w} / ${dim.h}` }}
               >
                  
                  {/* Base Rendered Image or Video Preview */}
                  {showFlipbookPreview && videoUrl ? (
                     <div className="absolute inset-0 w-full h-full bg-white">
                       <video
                         src={videoUrl}
                         autoPlay
                         loop
                         muted
                         playsInline
                         className="w-full h-full object-contain"
                         style={{ 
                           transform: "scaleX(-1)",
                           filter: videoPreviewFilter
                         }}
                       />
                       {templateImgUrl && (
                         /* eslint-disable-next-line @next/next/no-img-element */
                         <img 
                           src={templateImgUrl} 
                           alt="Template Overlay" 
                           className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                         />
                       )}
                     </div>
                  ) : allPreviewFrames[selectedFrameIndex] ? (
                     /* eslint-disable-next-line @next/next/no-img-element */
                     <img 
                        src={allPreviewFrames[selectedFrameIndex]} 
                        alt="Current Frame" 
                        className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none" 
                        draggable={false}
                     />
                  ) : (
                     <div className="absolute inset-0 flex items-center justify-center bg-white">
                       <div className="w-10 h-10 border-4 border-[#f15a09] border-t-transparent rounded-full animate-spin" />
                     </div>
                  )}

                  {/* Sequence Number Badge */}
                  <div className="absolute top-4 left-4 z-[30] bg-[#f15a09]/80 backdrop-blur-md text-white font-black text-lg px-3 py-1 rounded-xl pointer-events-none select-none">
                      {selectedFrameIndex}
                  </div>

                  {/* STICKER LAYER */}
                  <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden" style={{ width: dim.w, height: dim.h, transformOrigin: 'top left', transform: `scale(${previewScale})` }}>
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
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={st.url}
                          alt="Sticker"
                          draggable={false}
                          className="object-contain pointer-events-none w-full"
                          style={{
                            filter: selectedStickerId === st.id ? 'brightness(1.1)' : 'none'
                          }}
                        />

                        {selectedStickerId === st.id && (
                          <>
                            <div
                              className="absolute -top-[130px] left-1/2 -translate-x-1/2 w-[130px] h-[130px] bg-white border-[10px] border-[#f15a09] rounded-full flex items-center justify-center cursor-alias shadow-2xl text-[64px] leading-none text-[#f15a09] font-black hover:scale-105 active:scale-95 transition-transform"
                              onMouseDown={(e) => onStickerPointerDown(e, st.id, 'rotate')}
                              onTouchStart={(e) => onStickerPointerDown(e, st.id, 'rotate')}
                            >↻</div>
                            <div
                              className="absolute -bottom-[65px] -right-[65px] w-[130px] h-[130px] bg-white border-[10px] border-[#f15a09] rounded-full flex items-center justify-center cursor-nwse-resize shadow-2xl text-[64px] leading-none text-[#f15a09] font-black hover:scale-105 active:scale-95 transition-transform"
                              onMouseDown={(e) => onStickerPointerDown(e, st.id, 'scale')}
                              onTouchStart={(e) => onStickerPointerDown(e, st.id, 'scale')}
                            >⤡</div>
                            <div
                              className="absolute -top-[65px] -right-[65px] w-[130px] h-[130px] bg-rose-50 border-[10px] border-rose-500 rounded-full flex items-center justify-center cursor-pointer shadow-2xl text-[64px] leading-none text-rose-500 font-black hover:scale-105 active:scale-95 transition-transform"
                              onMouseDown={(e) => { e.stopPropagation(); deleteSelectedSticker(); }}
                              onTouchStart={(e) => { e.stopPropagation(); deleteSelectedSticker(); }}
                            >✕</div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Doodle Canvas */}
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



            <div className="flex-1 flex flex-row gap-2 min-h-0 min-w-0">

             <div className="w-[88px] shrink-0 flex flex-col min-h-0 gap-2">

                <h2 className={`${mochiyPopOne.className} text-white text-[9px] uppercase tracking-widest text-center shrink-0 drop-shadow-md`}>
                   HALAMAN
                </h2>

             <div className="flex-1 min-h-0 bg-white rounded-[16px] shadow-xl flex flex-col p-2 overflow-hidden border-3 border-white">
                <div className="flex-1 flex flex-col gap-2 overflow-y-auto pr-0.5" style={{ scrollbarWidth: "none" }}>
                  {allPreviewFrames.map((frame, idx) => (
                    <div 
                      key={idx} 
                      onClick={() => switchFrame(idx)}
                      className={`relative w-full aspect-[2/3] shrink-0 rounded-xl overflow-hidden border-4 shadow-md bg-white cursor-pointer transition-all ${selectedFrameIndex === idx ? 'border-[#f15a09] ring-4 ring-[#f15a09]/20 scale-105 z-10' : 'border-white opacity-60 hover:opacity-100 hover:border-orange-200'}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img 
                        src={frame} 
                        alt={`Frame ${idx}`} 
                        className="w-full h-full object-cover"
                        style={{ filter: previewFilter }}
                      />
                      {/* Show Doodles if they exist for this frame */}
                      {framesData[idx]?.doodle && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={framesData[idx].doodle} alt="Doodle" className="absolute inset-0 w-full h-full z-20 pointer-events-none" />
                      )}
                      {/* Page Label */}
                      <div className={`absolute top-1 left-1 z-30 ${selectedFrameIndex === idx ? 'bg-[#f15a09]' : 'bg-black/30'} backdrop-blur-sm text-white text-[8px] font-black px-1.5 py-0.5 rounded`}>
                        {idx}
                      </div>
                    </div>
                  ))}
                </div>
             </div>

             </div>



             <div className="flex-1 flex flex-col min-h-0 min-w-0 gap-2">

                <h2 className={`${mochiyPopOne.className} text-white text-sm uppercase tracking-widest text-center shrink-0 drop-shadow-md`}>
                   ALAT EDIT
                </h2>

             <div className="flex-1 min-h-0 bg-white rounded-[20px] shadow-2xl p-3 flex flex-col gap-3 overflow-y-auto border-3 border-white custom-scrollbar">
             
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
                    <button onClick={handleUndo} disabled={(framesData[selectedFrameIndex]?.history?.length || 0) <= 1} className="py-3 bg-slate-50 text-slate-400 rounded-2xl font-black text-xs uppercase tracking-widest border-2 border-slate-100 disabled:opacity-30 flex flex-col items-center gap-1 hover:bg-slate-100 transition-colors">
                       <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
                       UNDO
                    </button>
                    <button onClick={handleClear} disabled={(framesData[selectedFrameIndex]?.history?.length || 0) <= 1} className="py-3 bg-rose-50 text-rose-500 rounded-2xl font-black text-xs uppercase tracking-widest border-2 border-rose-100 disabled:opacity-30 flex flex-col items-center gap-1 hover:bg-rose-100 transition-colors">
                       <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                       HAPUS
                    </button>
                  </div>
               </div>
             ) : (
               <div className="flex flex-col flex-1 gap-3 animate-in slide-in-from-bottom-10 duration-500 w-full min-h-0">
                  <h4 className={`${mochiyPopOne.className} text-[#f15a09] text-[10px] uppercase tracking-widest`}>KOLEKSI STIKER</h4>
                  <div className="flex-1 overflow-y-auto grid grid-cols-2 gap-3 custom-scrollbar min-h-0" style={{ scrollbarWidth: "none" }}>
                    {stickersList.length === 0 ? (
                      <p className="col-span-2 text-center text-slate-300 text-xs font-bold uppercase mt-6">Tidak ada stiker...</p>
                    ) : (
                      stickersList.map((st) => {
                        let fullPath = st.image_path;
                        if (!fullPath.startsWith('http')) {
                          const cleanBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
                          const cleanPath = fullPath.startsWith("/") ? fullPath.slice(1) : fullPath;
                          fullPath = `${cleanBaseUrl}/storage/${cleanPath}`;
                        }
                        const proxyUrl = `/api/image-proxy?url=${encodeURIComponent(fullPath)}`;
                        return (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img key={st.id} src={proxyUrl} alt={st.name} onClick={() => addSticker(st)}
                            className="w-full h-28 object-contain bg-slate-50 border-4 border-white rounded-2xl p-2 cursor-pointer shadow-sm hover:border-[#f15a09] transition-all active:scale-95" />
                        );
                      })
                    )}
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

          </div>

        </main>

        <footer className="shrink-0 flex items-center justify-center gap-3 px-6 py-3 flex-wrap">
            <button
              onClick={() => {
                router.push(`/flipbook-camera?kanvas=${canvasType}&template=${templateId}&time=${timeLeft}`);
              }}
              className="rounded-full border-2 border-white px-6 py-2.5 text-xs font-black uppercase tracking-widest text-white transition-colors hover:bg-white/10"
            >
              KEMBALI KE KAMERA
            </button>
            <button
               onClick={() => setShowFlipbookPreview(!showFlipbookPreview)}
               disabled={!videoUrl}
               className={`flex items-center gap-2 px-6 py-2.5 rounded-full font-black text-xs tracking-widest transition-all duration-300 border-2 uppercase ${showFlipbookPreview ? "bg-white text-[#f15a09] border-white shadow-lg" : "bg-white/20 text-white border-white/40 hover:bg-white/30"} disabled:opacity-40 shrink-0`}
            >
               <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m22 8-6 4 6 4V8Z" /><rect width="14" height="12" x="2" y="6" rx="2" ry="2" /></svg>
               {showFlipbookPreview ? "TAMPILKAN COVER" : "PREVIEW ANIMASI"}
            </button>
           <button
             id="btn-finish"
             onClick={handleFinish}
             disabled={isProcessing}
             className="rounded-full bg-white px-10 py-2.5 text-sm font-black uppercase tracking-widest text-[#f15a09] shadow-xl transition-transform hover:scale-[1.03] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-70 select-none"
           >
             {isProcessing ? (
               <span className="flex items-center gap-3">
                 <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                 MEMPROSES...
               </span>
             ) : "SELESAI & LANJUT CETAK"}
           </button>
        </footer>
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}

export default function FlipbookRenderPage() {
  return (
    <Suspense fallback={
      <div className="h-screen w-full flex items-center justify-center bg-[#f15a09]">
        <div className="w-16 h-16 border-8 border-white border-t-transparent rounded-full animate-spin"></div>
      </div>
    }>
      <FlipbookRenderContent />
    </Suspense>
  );
}