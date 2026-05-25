import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const token = process.env.TOKEN;
    const baseUrl = process.env.BASE_URL?.replace(/\/$/, '').trim();

    if (!token || !baseUrl) {
      return NextResponse.json({ success: false, message: 'Server configuration error' }, { status: 500 });
    }

    const body = await request.json();
    const targetUrl = `${baseUrl}/api/transactions`;

    console.log(`[Transaction API] Forwarding transaction to ${targetUrl}`);

    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Machine-Token': token,
          "User-Agent": "Roambooth-Machine/1.0",
        },
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify(body),
      });

      const data = await response.json();
      return NextResponse.json(data, { status: response.status });
    } catch (e: any) {
      console.error(`[Transaction API] Failed to reach ${targetUrl}:`, e.message);
      return NextResponse.json({ success: false, message: 'Gagal terhubung ke server backend potopi.' }, { status: 504 });
    }

  } catch (error) {
    console.error('Transaction API Error:', error);
    return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
  }
}
