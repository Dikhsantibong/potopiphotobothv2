"use client";

import React, { useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Mochiy_Pop_One } from "next/font/google";

const mochiyPopOne = Mochiy_Pop_One({
  subsets: ["latin"],
  weight: "400",
});

export default function Home() {
  const router = useRouter();
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    </div>
  );
}
