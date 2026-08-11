import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const isActive = searchParams.get('is_active') || '';

    const token = process.env.TOKEN;
    const baseUrl = process.env.BASE_URL;

    if (!token || !baseUrl) {
      console.warn("WARNING: TOKEN or BASE_URL is not set in Next.js .env files.");
    }

    const sanitizedBaseUrl = baseUrl ? baseUrl.replace(/\/$/, "").trim() : "";

    const params = new URLSearchParams();
    if (isActive) params.set('is_active', isActive);

    const backendEndpoint = `${sanitizedBaseUrl}/api/iklan?${params.toString()}`;

    console.log(`[Iklan API] Fetching iklan from ${backendEndpoint}`);

    try {
      const response = await fetch(backendEndpoint, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'X-Machine-Token': token || '',
          "User-Agent": "Roambooth-Machine/1.0",
        },
        signal: AbortSignal.timeout(15000),
        next: { revalidate: 60 }, // Cache for 60 seconds to avoid hammering backend
      });

      const data = await response.json();
      if (!response.ok) {
        return NextResponse.json(data, { status: response.status });
      }

      return NextResponse.json({
        success: true,
        data: data.data || [],
        base_url: sanitizedBaseUrl,
      });
    } catch (e: any) {
      console.error(`[Iklan API] Failed to reach ${backendEndpoint}:`, e.message);
      return NextResponse.json({ success: false, message: 'Gagal menghubungi server iklan potopi.' }, { status: 504 });
    }

  } catch (error) {
    console.error('Iklan Fetch Error:', error);
    return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
  }
}
