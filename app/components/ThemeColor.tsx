"use client";

import { useEffect } from "react";

// ── Kustomisasi Warna Tema ──────────────────────────────────────────────
// Seluruh halaman memakai warna brand literal `#f15a09` lewat util Tailwind
// (mis. `bg-[#f15a09]`). Alih-alih mengganti 170+ pemakaian di banyak file,
// warna dioper lewat CSS variable `--brand`. Aturan override-nya ada di
// `globals.css` (memetakan tiap util warna brand ke `var(--brand)`), sehingga
// mengganti warna cukup dengan menyetel `--brand` di elemen <html>.
//
// Karena <html> tidak ikut di-remount saat pindah halaman (navigasi SPA),
// warna yang diset di sini otomatis berlaku di SEMUA halaman seketika, dan
// dipulihkan lagi dari localStorage setiap aplikasi dimuat ulang.

export const DEFAULT_BRAND = "#f15a09";
export const BRAND_STORAGE_KEY = "brandColor";

// Turunkan versi lebih gelap (~12%) untuk state hover.
function darken(hex: string, amount = 0.12): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amount));
  const g = Math.round(((n >> 8) & 255) * (1 - amount));
  const b = Math.round((n & 255) * (1 - amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

// Dipakai halaman Settings untuk preview + persist langsung, dan di sini saat
// aplikasi dimuat. Nilai kosong/invalid → kembali ke default (globals.css).
export function applyBrandColor(hex: string | null) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!hex || !/^#?[0-9a-fA-F]{6}$/.test(hex.trim())) {
    root.style.removeProperty("--brand");
    root.style.removeProperty("--brand-hover");
    return;
  }
  const clean = hex.trim().startsWith("#") ? hex.trim() : `#${hex.trim()}`;
  root.style.setProperty("--brand", clean);
  root.style.setProperty("--brand-hover", darken(clean));
}

export default function ThemeColor() {
  useEffect(() => {
    try {
      const saved = localStorage.getItem(BRAND_STORAGE_KEY);
      if (saved) applyBrandColor(saved);
    } catch {
      /* localStorage tidak tersedia — pakai default dari globals.css */
    }
  }, []);

  return null;
}
