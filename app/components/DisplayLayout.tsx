"use client";

import { useEffect } from "react";

// ── Mode Tampilan Layar (Landscape / Portrait) ──────────────────────────
// Mode dipilih di halaman Settings dan disimpan di localStorage. Saat Portrait,
// elemen <html> diberi atribut data-layout="portrait"; halaman-halaman lalu
// menyesuaikan tata letaknya lewat kelas Tailwind berawalan `potret:` (varian
// didefinisikan di globals.css). Landscape = atribut dihapus, jadi tampilan
// landscape sama persis seperti sebelum fitur ini ada.
//
// Tidak memakai state React di halaman, sehingga mengganti mode tidak me-remount
// elemen apa pun (mis. <video> kamera tetap memegang stream-nya).

export type DisplayLayoutMode = "landscape" | "portrait";

export const DISPLAY_LAYOUT_KEY = "displayLayout";

export function readDisplayLayout(): DisplayLayoutMode {
  try {
    return localStorage.getItem(DISPLAY_LAYOUT_KEY) === "portrait" ? "portrait" : "landscape";
  } catch {
    return "landscape";
  }
}

export function applyDisplayLayout(mode: DisplayLayoutMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (mode === "portrait") root.dataset.layout = "portrait";
  else delete root.dataset.layout;
}

export default function DisplayLayout() {
  useEffect(() => {
    applyDisplayLayout(readDisplayLayout());
  }, []);

  return null;
}
