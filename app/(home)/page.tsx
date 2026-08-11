"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Mochiy_Pop_One } from "next/font/google";

const mochiyPopOne = Mochiy_Pop_One({
  subsets: ["latin"],
  weight: "400",
});

interface IklanItem {
  id: number;
  title: string;
  image_path: string;
  image_url: string;
  status: string;
  link: string | null;
  description: string | null;
}

export default function Home() {
  const router = useRouter();
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Popup Banner States
  const [popupBanners, setPopupBanners] = useState<IklanItem[]>([]);
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0);
  const [showPopupBanner, setShowPopupBanner] = useState(false);
  const [bannerBaseUrl, setBannerBaseUrl] = useState("");
  const [bannerImageLoaded, setBannerImageLoaded] = useState(false);

  const handleLongPressStart = useCallback(() => {
    longPressTimer.current = setTimeout(() => {
      router.push("/settings");
    }, 1500);
  }, [router]);

  const handleLongPressEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleMulaiFoto = () => {
    router.push("/tutorial");

    fetch("/api/payment-gateway")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          localStorage.setItem("paymentGateway", JSON.stringify(data.data));
        }
      })
      .catch(() => { });
  };

  // Background fetch for templates and stickers when app is idle
  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const types = ["reguler", "koran", "flipbook"];
        for (const type of types) {
          try {
            const res = await fetch(`/api/templates?type=${type}`);
            const result = await res.json();
            if (result.success) {
              localStorage.setItem(`templates_${type}`, JSON.stringify(result.data));
              localStorage.setItem("templates_base_url", result.base_url || "");
            }
          } catch (e) {
            console.error(`Failed to fetch ${type} templates:`, e);
          }
        }
        
        try {
          const resStickers = await fetch(`/api/stickers`);
          const resultStickers = await resStickers.json();
          if (resultStickers.success) {
            localStorage.setItem("stickers", JSON.stringify(resultStickers.data));
          }
        } catch (e) {
          console.error(`Failed to fetch stickers:`, e);
        }
      } catch (e) {
        console.error("Background fetch failed:", e);
      }
    };

    // Run after a short delay so it doesn't block initial render
    const timeout = setTimeout(fetchTemplates, 2000);
    return () => clearTimeout(timeout);
  }, []);

  // Fetch popup banners from backend
  useEffect(() => {
    const fetchPopupBanners = async () => {
      try {
        const res = await fetch("/api/iklan?is_active=1");
        const result = await res.json();
        if (result.success && Array.isArray(result.data) && result.data.length > 0) {
          const activeBanners = result.data.filter(
            (item: IklanItem) => item.status === "active" && item.image_url
          );
          if (activeBanners.length > 0) {
            setPopupBanners(activeBanners);
            setBannerBaseUrl(result.base_url || "");
            setShowPopupBanner(true);
          }
        }
      } catch (e) {
        console.error("Failed to fetch popup banners:", e);
      }
    };

    // Fetch banners after a small delay to not block initial render
    const timeout = setTimeout(fetchPopupBanners, 1500);
    return () => clearTimeout(timeout);
  }, []);

  // Auto-rotate banners every 5 seconds
  useEffect(() => {
    if (!showPopupBanner || popupBanners.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentBannerIndex((prev) => (prev + 1) % popupBanners.length);
      setBannerImageLoaded(false);
    }, 5000);
    return () => clearInterval(interval);
  }, [showPopupBanner, popupBanners.length]);

  const handleCloseBanner = () => {
    setShowPopupBanner(false);
    setCurrentBannerIndex(0);
    setBannerImageLoaded(false);
  };

  const handleBannerDotClick = (index: number) => {
    setCurrentBannerIndex(index);
    setBannerImageLoaded(false);
  };

  const currentBanner = popupBanners[currentBannerIndex] || null;

  return (
    <div className="relative flex min-h-dvh w-full flex-col bg-[#f15a09] p-6 font-sans lg:p-8">
      {/* Hidden long-press zone — pojok kanan atas → Settings */}
      <div
        className="absolute right-0 top-0 z-50 h-[60px] w-[60px] cursor-default select-none"
        onMouseDown={handleLongPressStart}
        onMouseUp={handleLongPressEnd}
        onMouseLeave={handleLongPressEnd}
        onTouchStart={handleLongPressStart}
        onTouchEnd={handleLongPressEnd}
        onTouchCancel={handleLongPressEnd}
        aria-hidden="true"
      />

      <div className="flex min-h-0 flex-1 flex-col rounded-[2.5rem] border-[6px] border-white bg-[#f15a09]">
        <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
          <h1
            className={`mb-4 text-[clamp(3.5rem,14vw,7rem)] leading-none tracking-tight text-white ${mochiyPopOne.className}`}
          >
            potopi.
          </h1>
          <p
            className={`mt-7 mb-14 max-w-md text-[10px] font-bold uppercase tracking-[0.35em] text-white/95 sm:text-xs ${mochiyPopOne.className}`}
          >
            Photobooth - flipbook - newspaper
          </p>

          <button
            type="button"
            onClick={handleMulaiFoto}
            className="rounded-full bg-white px-14 py-4 text-sm font-black uppercase tracking-[0.2em] text-[#f15a09] shadow-lg transition-transform duration-200 hover:scale-[1.03] active:scale-[0.98] sm:px-16 sm:py-5 sm:text-base"
          >
            MULAI BERFOTO
          </button>
        </main>
      </div>

      {/* ============ POPUP BANNER IKLAN ============ */}
      {showPopupBanner && currentBanner && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          style={{ animation: "bannerFadeIn 0.3s ease-out" }}
        >
          <div
            className="relative flex flex-col items-center w-[90vw] max-w-2xl"
            style={{ animation: "bannerScaleIn 0.35s ease-out" }}
          >
            {/* Banner Image */}
            <div className="relative w-full overflow-hidden rounded-3xl shadow-[0_20px_80px_rgba(0,0,0,0.5)] border-4 border-white/20">
              {/* Loading skeleton */}
              {!bannerImageLoaded && (
                <div className="w-full aspect-[4/3] bg-white/10 animate-pulse rounded-3xl flex items-center justify-center">
                  <svg className="w-12 h-12 text-white/30 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round" />
                  </svg>
                </div>
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={currentBanner.image_url}
                alt={currentBanner.title || "Promo"}
                className={`w-full h-auto object-contain transition-opacity duration-300 ${bannerImageLoaded ? "opacity-100" : "opacity-0 absolute inset-0"}`}
                onLoad={() => setBannerImageLoaded(true)}
                onError={(e) => {
                  // If image_url fails, try constructing from base_url + storage path
                  const target = e.target as HTMLImageElement;
                  if (bannerBaseUrl && currentBanner.image_path && !target.dataset.retried) {
                    target.dataset.retried = "1";
                    const cleanBase = bannerBaseUrl.replace(/\/$/, "");
                    const cleanPath = currentBanner.image_path.replace(/^\//, "");
                    target.src = `${cleanBase}/storage/${cleanPath}`;
                  }
                }}
                draggable={false}
              />
            </div>

            {/* Dot Indicators */}
            {popupBanners.length > 1 && (
              <div className="flex items-center justify-center gap-2.5 mt-5">
                {popupBanners.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleBannerDotClick(idx)}
                    className={`rounded-full transition-all duration-300 ${
                      idx === currentBannerIndex
                        ? "w-8 h-3 bg-white shadow-[0_0_12px_rgba(255,255,255,0.6)]"
                        : "w-3 h-3 bg-white/40 hover:bg-white/60"
                    }`}
                    aria-label={`Banner ${idx + 1}`}
                  />
                ))}
              </div>
            )}

            {/* Close Button */}
            <button
              onClick={handleCloseBanner}
              className="mt-6 flex items-center gap-2 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-md px-8 py-3 text-white font-bold text-sm uppercase tracking-[0.15em] border border-white/30 shadow-lg transition-all duration-200 active:scale-95"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              TUTUP
            </button>
          </div>
        </div>
      )}

      {/* Banner Animations */}
      <style jsx>{`
        @keyframes bannerFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes bannerScaleIn {
          from { opacity: 0; transform: scale(0.9) translateY(20px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
