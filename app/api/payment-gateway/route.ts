import { NextResponse } from "next/server";

export async function GET() {
  const baseUrl = process.env.BASE_URL;
  const token = process.env.TOKEN;

  if (!baseUrl || !token) {
    return NextResponse.json(
      { success: false, message: "Konfigurasi server belum lengkap" },
      { status: 500 }
    );
  }

  try {
    const url = `${baseUrl.replace(/\/$/, "")}/api/payment-gateway`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Machine-Token": token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    const data = await response.json();

    console.log("[Payment Gateway] Status:", response.status);
    console.log("[Payment Gateway] Response:", JSON.stringify(data, null, 2));

    if (!response.ok) {
      return NextResponse.json(
        { success: false, message: data.message || "Gagal mengambil data" },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Payment gateway fetch error:", error);
    return NextResponse.json(
      { success: false, message: "Tidak dapat terhubung ke server" },
      { status: 503 }
    );
  }
}
