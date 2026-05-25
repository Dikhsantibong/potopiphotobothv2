"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mochiy_Pop_One } from "next/font/google";

const mochiyPopOne = Mochiy_Pop_One({
  subsets: ["latin"],
  weight: "400",
});

type PricingShape = {
  amount_reguler?: number;
  amount_flipbook?: number;
  amount_koran?: number;
  amount_print_reguler?: number;
  amount_print_flipbook?: number;
  amount_print_koran?: number;
};

const defaultPricing: PricingShape = {
  amount_koran: 30000,
  amount_reguler: 12000,
  amount_flipbook: 65000,
  amount_print_koran: 10000,
  amount_print_reguler: 3000,
  amount_print_flipbook: 20000,
};

/** Ringkas untuk label kartu (mis. 35000 → "35K") */
function formatCompactIdr(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  const k = Math.round(n / 1000);
  return `${k}K`;
}

/** Ikon versi lama halaman pilih kanvas (grid strip / koran / buku) */
const canvasOptions = [
  {
    id: "reguler",
    displayTitle: "STRIP REGULER",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="80"
        height="80"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="3" y="2" width="7" height="9" rx="1.5" />
        <rect x="14" y="2" width="7" height="9" rx="1.5" />
        <rect x="3" y="13" width="7" height="9" rx="1.5" />
        <rect x="14" y="13" width="7" height="9" rx="1.5" />
      </svg>
    ),
  },
  {
    id: "flipbook",
    displayTitle: "FLIPBOOK",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="80"
        height="80"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
        <rect x="8" y="6" width="8" height="8" rx="1" />
        <path d="M8 17h8" />
        <path d="M8 19h5" />
      </svg>
    ),
  },
  {
    id: "koran",
    displayTitle: "NEWSPAPER",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="80"
        height="80"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="2" y="3" width="20" height="18" rx="2" />
        <line x1="5" y1="7" x2="19" y2="7" />
        <line x1="5" y1="10" x2="12" y2="10" />
        <line x1="5" y1="12.5" x2="12" y2="12.5" />
        <line x1="5" y1="15" x2="12" y2="15" />
        <line x1="5" y1="17.5" x2="10" y2="17.5" />
        <rect x="14" y="10" width="5" height="5" rx="0.5" />
      </svg>
    ),
  },
];

const defaultEnabled: Record<string, boolean> = {
  koran: true,
  reguler: true,
  flipbook: true,
};

function loadEnabledCanvas(): Record<string, boolean> {
  if (typeof window === "undefined") return defaultEnabled;
  try {
    const raw = localStorage.getItem("enabledCanvas");
    if (!raw) return defaultEnabled;
    return { ...defaultEnabled, ...JSON.parse(raw) };
  } catch {
    return defaultEnabled;
  }
}

function loadPricing(): PricingShape {
  if (typeof window === "undefined") return defaultPricing;
  try {
    const raw = localStorage.getItem("paymentGateway");
    if (!raw) return defaultPricing;
    return { ...defaultPricing, ...JSON.parse(raw) };
  } catch {
    return defaultPricing;
  }
}

function initialSelected(enabled: Record<string, boolean>): string {
  return canvasOptions.find((opt) => enabled[opt.id])?.id ?? "koran";
}

export default function PilihKanvas() {
  const router = useRouter();
  const [enabledCanvas] = useState(loadEnabledCanvas);
  const [selected, setSelected] = useState(() =>
    initialSelected(loadEnabledCanvas()),
  );
  const [pricing] = useState(loadPricing);

  const amountFor = (id: string) => {
    const key = `amount_${id}` as keyof PricingShape;
    return Number(pricing[key]) || 0;
  };

  const visibleOptions = canvasOptions.filter((o) => enabledCanvas[o.id]);

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
        </header>

        <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 overflow-y-auto px-4 py-8 sm:px-6">
          <div className="flex w-full max-w-3xl flex-wrap items-center justify-center gap-4 sm:gap-5 md:flex-nowrap md:items-stretch">
            {visibleOptions.map((option) => {
              const isSelected = selected === option.id;
              const priceLabel = formatCompactIdr(amountFor(option.id));
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setSelected(option.id)}
                  title={`${option.displayTitle} — ${priceLabel}`}
                  className={[
                    "relative flex w-full min-w-0 flex-col rounded-2xl bg-white p-4 text-left shadow-md transition-[outline-color] duration-200 sm:p-5",
                    "aspect-4/3 max-w-[280px] flex-1 sm:max-w-[300px]",
                    isSelected
                      ? "z-1 outline-2 outline-offset-4 outline-white"
                      : "outline-2 outline-offset-4 outline-transparent hover:outline-white/50",
                  ].join(" ")}
                >
                  <span className="absolute right-3 top-2.5 text-base font-black tabular-nums text-[#f15a09] sm:right-4 sm:top-3 sm:text-lg">
                    {priceLabel}
                  </span>
                  <div className="flex min-h-0 flex-1 items-center justify-center text-[#f15a09] [&>svg]:h-18 [&>svg]:w-18 sm:[&>svg]:h-20 sm:[&>svg]:w-20">
                    {option.icon}
                  </div>
                  <span className="shrink-0 text-center text-[11px] font-black uppercase tracking-wide text-[#f15a09] sm:text-xs">
                    {option.displayTitle}
                  </span>
                </button>
              );
            })}
          </div>
        </main>

        <footer className="flex shrink-0 flex-wrap items-center justify-center gap-3 px-6 pb-8 pt-2">
          <Link
            href="/tutorial"
            className="rounded-full border-2 border-white px-8 py-3 text-sm font-black uppercase tracking-widest text-white transition-colors hover:bg-white/10"
          >
            KEMBALI
          </Link>
          <button
            type="button"
            onClick={() => router.push(`/pembayaran?kanvas=${selected}`)}
            className="rounded-full bg-white px-10 py-3 text-sm font-black uppercase tracking-widest text-[#f15a09] shadow-lg transition-transform hover:scale-[1.03] active:scale-[0.98]"
          >
            LANJUT
          </button>
        </footer>
      </div>
    </div>
  );
}
