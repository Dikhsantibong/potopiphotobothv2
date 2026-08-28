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
 * - provider 'eosutility'    → Canon EOS Utility tidak punya API live view,
 *                              jadi liveViewSupported=false dan frame loop
 *                              tidak pernah dijalankan.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type CameraProvider = "webcam" | "digicamcontrol" | "eosutility";

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
  startLiveView: () => Promise<{ ok: boolean; error?: string; liveViewSupported?: boolean }>;
  stopLiveView: () => Promise<{ ok: boolean }>;
  capture: () => Promise<{ ok: boolean; dataUrl?: string; filePath?: string; error?: string }>;
  armCapture: () => Promise<{ ok: boolean; error?: string }>;
  fireShutter: () => Promise<{ ok: boolean; command?: string; error?: string }>;
  collectPhoto: () => Promise<{ ok: boolean; dataUrl?: string; filePath?: string; error?: string }>;
  getShutterCommand: () => Promise<string>;
  browseFolder: (current?: string) => Promise<{ ok: boolean; path?: string; canceled?: boolean }>;
  getPreviewSource: () => Promise<string>;
  setPreviewSource: (value: string) => Promise<{ ok: boolean; value: string }>;
  getEosUtilityFolder: () => Promise<string>;
  setEosUtilityFolder: (value: string) => Promise<{ ok: boolean; value: string }>;
  getEosUtilityShutter: () => Promise<string>;
  setEosUtilityShutter: (value: string) => Promise<{ ok: boolean; value: string }>;
  setShutterCommand: (value: string) => Promise<{ ok: boolean; value: string }>;
  /** code: 'BUSY' (operasi kritis jalan), 'ABORTED', 'LIVEVIEW_LOST', 'LIVEVIEW_INACTIVE' */
  getFrame: () => Promise<{ ok: boolean; data?: Uint8Array; mime?: string; error?: string; code?: string }>;
  getLastCaptured: () => Promise<{ ok: boolean; filename: string | null }>;
  downloadPhoto: (filename: string) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
  getProvider: () => Promise<CameraProvider>;
  setProvider: (name: CameraProvider) => Promise<CameraStatus & { ok: boolean; code?: string; rolledBackTo?: CameraProvider }>;
  onProviderChanged: (cb: (status: CameraStatus) => void) => void;
  setSessionActive: (active: boolean) => Promise<unknown>;
  getImageQuality: () => Promise<string>;
  setImageQuality: (value: string) => Promise<{ ok: boolean; value: string; appliedNow?: boolean }>;
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
  const [liveViewState, setLiveViewState] = useState<"idle" | "starting" | "running" | "reconnecting" | "unsupported" | "error">("idle");
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
  /** Referensi ke startLiveView, dipakai frame loop untuk menyambung ulang sendiri. */
  const startLiveViewRef = useRef<(() => Promise<unknown>) | null>(null);
  /** Sedang menyambung ulang — cegah percobaan bertumpuk. */
  const reconnectingRef = useRef(false);
  /** Percobaan sambung ulang beruntun, untuk backoff. */
  const reconnectAttemptsRef = useRef(0);
  /**
   * Sebagian provider tidak menyediakan live view sama sekali (Canon EOS
   * Utility). Frame loop tidak boleh dijalankan untuk provider seperti itu —
   * hanya membuang CPU dan mengisi log dengan NOT_SUPPORTED.
   */
  const [liveViewSupported, setLiveViewSupported] = useState(true);
  const liveViewSupportedRef = useRef(true);
  /**
   * Hybrid DSLR Mode: preview diambil dari webcam (HDMI capture card),
   * sementara foto tetap dari provider DSLR. Default 'provider' = perilaku lama.
   */
  const [previewSource, setPreviewSourceState] = useState<"provider" | "webcam">("provider");

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

        try {
          const src = await bridge.getPreviewSource?.();
          if (alive && (src === "webcam" || src === "provider")) setPreviewSourceState(src);
        } catch {
          /* pakai default 'provider' */
        }

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
      // Dukungan live view dinilai ulang saat startLiveView provider baru.
      liveViewSupportedRef.current = true;
      setLiveViewSupported(true);
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
    // Provider tanpa live view (mis. EOS Utility) tidak punya frame untuk dipoll.
    if (!liveViewSupportedRef.current) return;
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
          reconnectAttemptsRef.current = 0;
        } else if (
          // LIVEVIEW_LOST hanya dikirim SEKALI (saat live view baru ketahuan
          // putus). Sesudah itu service menjawab LIVEVIEW_INACTIVE terus, jadi
          // kode itu juga harus memicu percobaan berikutnya — kalau tidak,
          // satu percobaan gagal berarti preview beku selamanya.
          (res?.code === "LIVEVIEW_LOST" || res?.code === "LIVEVIEW_INACTIVE") &&
          // Hanya kalau live view memang pernah hidup. Sebelum itu, halaman
          // yang bertanggung jawab memulainya.
          liveViewStartedRef.current &&
          !reconnectingRef.current
        ) {
          // digiCamControl tertutup, crash, atau kamera dicabut. Sambung ulang
          // sendiri — tanpa ini preview membeku sampai user keluar halaman.
          reconnectingRef.current = true;
          setLiveViewState("reconnecting");

          const attempt = ++reconnectAttemptsRef.current;
          // Backoff bertahap supaya tidak membanjiri server yang sedang bangkit.
          const backoff = Math.min(5000, 500 * attempt);

          setTimeout(() => {
            const restart = startLiveViewRef.current;
            if (!restart || state.cancelled) {
              reconnectingRef.current = false;
              return;
            }
            void Promise.resolve(restart()).finally(() => {
              reconnectingRef.current = false;
            });
          }, backoff);
        }
        // code 'BUSY' dan 'ABORTED' adalah kondisi normal — abaikan diam-diam.
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
    // Hentikan polling frame SEBELUM mengirim perintah.
    // Web server digiCamControl melayani request secara berurutan; kalau frame
    // loop terus memoll /liveview.jpg, perintah LiveViewWnd_Show terjebak di
    // belakang antrean dan berakhir timeout.
    stopFrameLoop();
    setLiveViewUrl(null);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    const res = await bridge.startLiveView();
    if (!res?.ok) {
      setLiveViewState("error");
      setConnected(false);
      setError(res?.error || "Gagal memulai live view");
      return res;
    }
    setConnected(true);
    setError(null);

    // Provider boleh menyatakan live view tidak tersedia; itu bukan kegagalan.
    const supported = res?.liveViewSupported !== false;
    liveViewSupportedRef.current = supported;
    setLiveViewSupported(supported);

    if (!supported) {
      setLiveViewState("unsupported");
      liveViewStartedRef.current = false; // jangan pernah coba sambung ulang
      return res;
    }

    liveViewStartedRef.current = true;
    reconnectAttemptsRef.current = 0;
    startFrameLoop();
    return res;
  }, [activeProvider, startFrameLoop, stopFrameLoop]);

  // Frame loop memanggilnya lewat ref supaya tidak ada ketergantungan melingkar.
  startLiveViewRef.current = startLiveView;

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

  /**
   * Siapkan kamera saat countdown mulai: live view dipastikan hidup, baseline
   * file diambil, dan kamera difokuskan. Semua pekerjaan yang bisa menunda
   * shutter dikerjakan di sini, bukan di detik nol.
   */
  const armCapture = useCallback(async () => {
    const bridge = getCameraBridge();
    if (!bridge?.armCapture) return { ok: true, skipped: true };
    try {
      return await bridge.armCapture();
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }, []);

  /** Momen jepret. Sengaja tidak menyentuh state agar tidak menunda apa pun?
   *  Tidak, kita set isCapturing agar live view benar-benar pause.
   */
  const fireShutter = useCallback(async () => {
    const bridge = getCameraBridge();
    if (!bridge?.fireShutter) return { ok: false, error: "Bridge kamera tidak tersedia" };
    setIsCapturing(true);
    stopFrameLoop();
    try {
      return await bridge.fireShutter();
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    } finally {
      setIsCapturing(false);
    }
  }, [stopFrameLoop]);

  /** Ambil file hasil jepretan — berjalan setelah momen foto, bukan sebelumnya. */
  const collectPhoto = useCallback(async () => {
    const bridge = getCameraBridge();
    if (!bridge?.collectPhoto) return { ok: false, error: "Bridge kamera tidak tersedia" };
    // Tidak mengatur isCapturing=true di sini karena collectPhoto berjalan
    // paralel di latar belakang. Jika diset true, live view tidak bisa jalan!
    setError(null);
    try {
      const res = await bridge.collectPhoto();
      // Sengaja TIDAK memasang error global di sini. Halaman kamera sudah
      // memasang preview sementara dari frame live view, jadi memunculkan
      // banner merah hanya membuat panik padahal sesi tetap berjalan.
      // Pemanggil yang memutuskan apakah kegagalan ini perlu ditampilkan.
      if (!res?.ok) console.warn("[useCamera] collectPhoto gagal:", res?.error);
      return res;
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      return { ok: false, error: message };
    }
  }, []);

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
    liveViewSupported,
    previewSource,
    /**
     * Preview harus diambil dari getUserMedia? Benar bila provider-nya memang
     * webcam, ATAU Hybrid DSLR Mode aktif (preview HDMI, foto lewat DSLR).
     */
    previewFromWebcam: activeProvider === "webcam" || previewSource === "webcam",
    capture,
    armCapture,
    fireShutter,
    collectPhoto,
    /** true bila halaman harus memakai flow getUserMedia existing */
    usesWebcam: activeProvider === "webcam",
  };
}
