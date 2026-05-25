import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { code, type } = await request.json();

    if (!code || !type) {
      return NextResponse.json({ valid: false, message: 'Code and type are required' }, { status: 400 });
    }

    const token = process.env.TOKEN;
    const baseUrl = process.env.BASE_URL;

    if (!token || !baseUrl) {
      console.warn("WARNING: TOKEN or BASE_URL is not set in Next.js .env files.");
    }

    // Hindari double slash jika ujungnya ada trailing slash
    const sanitizedBaseUrl = baseUrl ? baseUrl.replace(/\/$/, "").trim() : "";
    const backendEndpoint = `${sanitizedBaseUrl}/api/vouchers`;
    
    console.log(`[Voucher API] Validating code "${code}" at ${backendEndpoint}`);

    let response;
    try {
      response = await fetch(backendEndpoint, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "X-Machine-Token": token || "",
          "User-Agent": "Roambooth-Machine/1.0",
        },
        signal: AbortSignal.timeout(30000), 
        body: JSON.stringify({ code, type }),
      });
    } catch (e: any) {
      console.error(`[Voucher API] Connection failed to ${backendEndpoint}:`, e.message);
      return NextResponse.json({ valid: false, message: 'Gagal terhubung ke server backend potopi.' }, { status: 504 });
    }

    const data = await response.json();

    if (!response.ok) {
        // Laravel mengembalikan error seperti "Voucher not valid!" dsb.
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);

  } catch (error) {
    console.error('Voucher Validation Error:', error);
    return NextResponse.json({ valid: false, message: 'Internal Server Error' }, { status: 500 });
  }
}
