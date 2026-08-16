"use client";

/**
 * useCamera()
 * -----------
 * Hook kamera yang agnostik terhadap provider. Komponen UI photobooth tidak
 * perlu tahu apakah di belakangnya digiCamControl atau EOS Webcam Utility.
 *
 * - provider 'webcam'        → hook tidak mengambil alih apa pun; halaman tetap
 *                              memakai getUserMedia miliknya sendiri (flow existing).
 * - provider 'digicamcontrol'→ hook memoll frame live view lewat IPC dan
 *                              menyediakan liveViewUrl untuk dipasang di <img>.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type CameraProvider = "webcam" | "digicamcontrol";

export interface CameraStatus {
  connected: boolean;
  provider?: CameraProvider;
  error?: string;
  [key: string]: unknown;
}

export interface WebcamControls {
  /** Mulai/lanjutkan MediaStream milik halaman. */
  start?: () => void | Promise<void>;
  /** Hentikan MediaStream milik halaman (track.stop()). */
  stop?: () => void;
  /** Apakah stream sedang berjalan. */
  isStreaming?: () => boolean;
}

export interface UseCameraOptions {
  /** Kontrol webcam milik halaman, dipakai Main untuk menghentikan stream saat provider diganti. */
  webcamControls?: WebcamControls;
  /** Tandai sesi photobooth berjalan selama komponen ter-mount (mengunci perpindahan provider). */
  markSessionActive?: boolean;
  /** FPS polling live view digiCamControl. 10–15 sudah cukup untuk preview. */
  fps?: number;
  /** Mulai live view otomatis saat provider = digicamcontrol. */
  autoStart?: boolean;
}

interface CameraBridge {
  healthCheck: () => Promise<CameraStatus>;
  getStatus: () => Promise<CameraStatus>;
  startLiveView: () => Promise<{ ok: boolean; error?: string }>;
  stopLiveView: () => Promise<{ ok: boolean }>;
  capture: () => Promise<{ ok: boolean; dataUrl?: string; filePath?: string; error?: string }>;
  getFrame: () => Promise<{ ok: boolean; data?: Uint8Array; mime?: string; error?: string }>;
  getLastCaptured: () => Promise<{ ok: boolean; filename: string | null }>;
  downloadPhoto: (filename: string) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
  getProvider: () => Promise<CameraProvider>;
  setProvider: (name: CameraProvider) => Promise<CameraStatus & { ok: boolean; code?: string; rolledBackTo?: CameraProvider }>;
  onProviderChanged: (cb: (status: CameraStatus) => void) => void;
  setSessionActive: (active: boolean) => Promise<unknown>;
  onWebcamRequest: (cb: (payload: { id: string; action: string; data?: unknown }) => void) => void;
  respondWebcam: (payload: { id: string; ok: boolean; data?: unknown; error?: string }) => void;
}

export function getCameraBridge(): CameraBridge | null {
  if (typeof window === "undefined") return null;
  return ((window as unknown as { camera?: CameraBridge }).camera) || null;
}

export function useCamera(options: UseCameraOptions = {}) {
  const { webcamControls, markSessionActive = false, fps = 12, autoStart = false } = options;

  const [activeProvider, setActiveProvider] = useState<CameraProvider>("webcam");
  const [providerReady, setProviderReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [liveViewUrl, setLiveViewUrl] = useState<string | null>(null);
  const [liveViewState, setLiveViewState] = useState<"idle" | "starting" | "running" | "error">("idle");
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const controlsRef = useRef<WebcamControls | undefined>(webcamControls);
  controlsRef.current = webcamControls;

  const objectUrlRef = useRef<string | null>(null);
  const pollingRef = useRef<{ cancelled: boolean; timer: ReturnType<typeof setTimeout> | null }>({
    cancelled: false,
    timer: null,
  });
  /** Live view sudah pernah dimulai — syarat sebelum frame loop boleh di-resume. */
  const liveViewStartedRef = useRef(false);

  const setFrame = useCallback((bytes: Uint8Array, mime: string) => {
    const blob = new Blob([new Uint8Array(bytes)], { type: mime || "image/jpeg" });
    const url = URL.createObjectURL(blob);
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = url;
    setLiveViewUrl(url);
  }, []);

  // ── Resolusi provider aktif ────────────────────────────────
  useEffect(() => {
    let alive = true;
    const bridge = getCameraBridge();

    if (!bridge) {
      // Dijalankan di browser biasa (npm run dev tanpa Electron):
      // pertahankan perilaku lama — webcam.
      setActiveProvider("webcam");
      setConnected(true);
      setProviderReady(true);
      return;
    }

    (async () => {
      try {
        const name = await bridge.getProvider();
        if (!alive) return;
        setActiveProvider(name || "webcam");
        const health = await bridge.healthCheck();
        if (!alive) return;
        setConnected(!!health?.connected);
        setError(health?.connected ? null : health?.error || null);
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setProviderReady(true);
      }
    })();

    bridge.onProviderChanged((status) => {
      if (!alive) return;
      if (status?.provider) setActiveProvider(status.provider);
      setConnected(!!status?.connected);
      setError(status?.error || null);
      // Reset live view: frame dari provider lama tidak boleh tertinggal.
      setLiveViewUrl(null);
      setLiveViewState("idle");
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    });

    return () => {
      alive = false;
    };
  }, []);

  // ── Jembatan perintah webcam dari Main Process ─────────────
  useEffect(() => {
    const bridge = getCameraBridge();
    if (!bridge) return;

    bridge.onWebcamRequest(async ({ id, action }) => {
      try {
        if (action === "stop") {
          controlsRef.current?.stop?.();
          bridge.respondWebcam({ id, ok: true, data: { stopped: true } });
          return;
        }
        if (action === "start") {
          await controlsRef.current?.start?.();
          bridge.respondWebcam({ id, ok: true, data: { started: true } });
          return;
        }
        // action === 'status'
        let videoInputs: number | null = null;
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          videoInputs = devices.filter((d) => d.kind === "videoinput").length;
        } catch {
          videoInputs = null;
        }
        bridge.respondWebcam({
          id,
          ok: true,
          data: { videoInputs, streaming: !!controlsRef.current?.isStreaming?.() },
        });
      } catch (e) {
        bridge.respondWebcam({ id, ok: false, error: (e as Error).message });
      }
    });
  }, []);

  // ── Kunci perpindahan provider selama sesi berjalan ────────
  useEffect(() => {
    if (!markSessionActive) return;
    const bridge = getCameraBridge();
    if (!bridge) return;
    bridge.setSessionActive(true).catch(() => { });
    return () => {
      bridge.setSessionActive(false).catch(() => { });
    };
  }, [markSessionActive]);

  // ── Live view (hanya provider berbasis frame HTTP) ─────────
  const stopFrameLoop = useCallback(() => {
    pollingRef.current.cancelled = true;
    if (pollingRef.current.timer) clearTimeout(pollingRef.current.timer);
    pollingRef.current.timer = null;
  }, []);

  const startFrameLoop = useCallback(() => {
    const bridge = getCameraBridge();
    if (!bridge) return;
    stopFrameLoop();
    const state = { cancelled: false, timer: null as ReturnType<typeof setTimeout> | null };
    pollingRef.current = state;
    const interval = Math.max(50, Math.round(1000 / Math.min(Math.max(fps, 1), 30)));

    const tick = async () => {
      if (state.cancelled) return;
      try {
        const res = await bridge.getFrame();
        if (state.cancelled) return;
        if (res?.ok && res.data) {
          setFrame(res.data, res.mime || "image/jpeg");
          setLiveViewState("running");
        }
      } catch {
        /* frame gagal sesekali bukan alasan menghentikan preview */
      }
      if (state.cancelled) return;
      state.timer = setTimeout(tick, interval);
    };

    void tick();
  }, [fps, setFrame, stopFrameLoop]);

  const startLiveView = useCallback(async () => {
    const bridge = getCameraBridge();
    if (!bridge) return { ok: true, deferred: true };
    if (activeProvider === "webcam") {
      // Halaman mengelola getUserMedia-nya sendiri — jangan campur tangan.
      return { ok: true, deferred: true };
    }

    setLiveViewState("starting");
    const res = await bridge.startLiveView();
    if (!res?.ok) {
      setLiveViewState("error");
      setConnected(false);
      setError(res?.error || "Gagal memulai live view");
      return res;
    }
    setConnected(true);
    setError(null);
    liveViewStartedRef.current = true;
    startFrameLoop();
    return res;
  }, [activeProvider, startFrameLoop]);

  /**
   * Hentikan sementara polling frame tanpa mematikan live view di kamera.
   * Dipakai saat capture berjalan dan saat preview foto ditampilkan — web server
   * digiCamControl melayani request secara berurutan, jadi membanjirinya dengan
   * /liveview.jpg membuat Capture dan download foto ikut melambat.
   */
  const pauseFrames = useCallback(() => {
    stopFrameLoop();
  }, [stopFrameLoop]);

  const resumeFrames = useCallback(() => {
    if (!liveViewStartedRef.current) return;
    if (pollingRef.current && !pollingRef.current.cancelled && pollingRef.current.timer) return;
    startFrameLoop();
  }, [startFrameLoop]);

  const stopLiveView = useCallback(async () => {
    stopFrameLoop();
    liveViewStartedRef.current = false;
    setLiveViewState("idle");
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setLiveViewUrl(null);

    const bridge = getCameraBridge();
    if (!bridge || activeProvider === "webcam") return { ok: true };
    return bridge.stopLiveView();
  }, [activeProvider, stopFrameLoop]);

  const capture = useCallback(async () => {
    const bridge = getCameraBridge();
    if (!bridge) return { ok: false, error: "Bridge kamera tidak tersedia" };
    setIsCapturing(true);
    // Error dari percobaan sebelumnya tidak boleh menempel di layar saat
    // percobaan baru sedang berjalan.
    setError(null);
    // Bebaskan web server digiCamControl selama shutter + transfer file.
    stopFrameLoop();
    try {
      const res = await bridge.capture();
      if (!res?.ok) setError(res?.error || "Capture gagal");
      return res;
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      return { ok: false, error: message };
    } finally {
      setIsCapturing(false);
    }
  }, [stopFrameLoop]);

  // Auto start / cleanup live view untuk provider non-webcam
  useEffect(() => {
    if (!providerReady) return;
    if (activeProvider !== "digicamcontrol") {
      stopFrameLoop();
      return;
    }
    if (autoStart) void startLiveView();
    return () => {
      stopFrameLoop();
    };
  }, [providerReady, activeProvider, autoStart, startLiveView, stopFrameLoop]);

  // Buang object URL terakhir saat unmount
  useEffect(() => {
    return () => {
      stopFrameLoop();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [stopFrameLoop]);

  return {
    connected,
    activeProvider,
    providerReady,
    liveViewUrl,
    liveViewState,
    isCapturing,
    error,
    startLiveView,
    stopLiveView,
    pauseFrames,
    resumeFrames,
    capture,
    /** true bila halaman harus memakai flow getUserMedia existing */
    usesWebcam: activeProvider === "webcam",
  };
}
