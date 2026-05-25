"use client";

import React, { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mochiy_Pop_One } from "next/font/google";

const mochiyPopOne = Mochiy_Pop_One({
  subsets: ["latin"],
  weight: "400",
});

const steps = [
  {
    step: "01",
    title: "Template",
    illustrationIcon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="64"
        height="64"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <rect x="5.5" y="5.5" width="5.5" height="5.5" rx="1" />
        <rect x="13" y="5.5" width="5.5" height="5.5" rx="1" />
        <rect x="5.5" y="13" width="5.5" height="5.5" rx="1" />
        <rect x="13" y="13" width="5.5" height="5.5" rx="1" />
      </svg>
    ),
  },
  {
    step: "02",
    title: "Berpose",
    illustrationIcon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="64"
        height="64"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <circle cx="12" cy="10" r="3" />
        <path d="M7 21v-2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2" />
      </svg>
    ),
  },
  {
    step: "03",
    title: "Timer",
    illustrationIcon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="64"
        height="64"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M8 3h8" />
        <path d="M12 3v4" />
        <circle cx="12" cy="14" r="4" />
        <polyline points="12 12 12 14 13.5 15" />
      </svg>
    ),
  },
  {
    step: "04",
    title: "Cetak",
    illustrationIcon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="64"
        height="64"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <polyline points="6 9 6 2 18 2 18 9" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <rect width="12" height="8" x="6" y="14" />
        <line x1="9" y1="17" x2="15" y2="17" />
        <line x1="9" y1="19" x2="13" y2="19" />
      </svg>
    ),
  },
];

export default function Tutorial() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleLanjut = useCallback(() => {
    const data = localStorage.getItem("paymentGateway");
    if (data) {
      router.push("/pilih-kanvas");
      return;
    }

    setIsLoading(true);
    const interval = setInterval(() => {
      const check = localStorage.getItem("paymentGateway");
      if (check) {
        clearInterval(interval);
        setIsLoading(false);
        router.push("/pilih-kanvas");
      }
    }, 300);

    setTimeout(() => {
      clearInterval(interval);
      setIsLoading(false);
      router.push("/pilih-kanvas");
    }, 10000);
  }, [router]);

  return (
    <div className="relative flex min-h-dvh w-full flex-col bg-[#f15a09] p-6 font-sans lg:p-8">
      <div className="flex min-h-0 flex-1 flex-col rounded-[2.5rem] border-[6px] border-white bg-[#f15a09]">
        <header className="shrink-0 px-6 pt-10 text-center">
          <h1
            className={`text-[clamp(2rem,8vw,3.5rem)] leading-none tracking-tight text-white ${mochiyPopOne.className}`}
          >
            potopi.
          </h1>
          <p
            className={`mx-auto mt-5 max-w-md text-[9px] font-bold uppercase tracking-[0.35em] text-white/95 sm:text-[10px] ${mochiyPopOne.className}`}
          >
            Photobooth - flipbook - newspaper
          </p>
          <p className="mx-auto mt-4 max-w-lg px-2 text-sm font-medium leading-snug text-white/90">
            Empat langkah sederhana sebelum Anda memilih kanvas dan berfoto.
          </p>
        </header>

        <main className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
          <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-5">
            {steps.map((item) => (
              <div
                key={item.step}
                className="relative flex min-h-[200px] flex-col rounded-2xl bg-white p-4 shadow-md sm:min-h-[220px] sm:p-5"
              >
                <span className="absolute right-3 top-2.5 text-base font-black tabular-nums text-[#f15a09] sm:right-4 sm:top-3 sm:text-lg">
                  {item.step}
                </span>
                <div className="flex flex-1 items-center justify-center py-3 text-[#f15a09] sm:py-4 [&>svg]:h-14 [&>svg]:w-14 sm:[&>svg]:h-16 sm:[&>svg]:w-16">
                  {item.illustrationIcon}
                </div>
                <h3 className="shrink-0 text-center text-sm font-black uppercase tracking-widest text-[#f15a09] sm:text-base">
                  {item.title}
                </h3>
              </div>
            ))}
          </div>
        </main>

        <footer className="flex shrink-0 flex-wrap items-center justify-center gap-3 px-6 pb-8 pt-2">
          <Link
            href="/"
            className="rounded-full border-2 border-white px-8 py-3 text-sm font-black uppercase tracking-widest text-white transition-colors hover:bg-white/10"
          >
            KEMBALI
          </Link>
          <button
            type="button"
            onClick={handleLanjut}
            disabled={isLoading}
            className="rounded-full bg-white px-10 py-3 text-sm font-black uppercase tracking-widest text-[#f15a09] shadow-lg transition-transform hover:scale-[1.03] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-70"
          >
            {isLoading ? "MEMUAT…" : "LANJUT"}
          </button>
        </footer>
      </div>
    </div>
  );
}
