import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');

    if (!type) {
      return NextResponse.json({ message: 'Type is required' }, { status: 400 });
    }

    const token = process.env.TOKEN;
    const baseUrl = process.env.BASE_URL;

    if (!token || !baseUrl) {
      console.warn("WARNING: TOKEN or BASE_URL is not set in Next.js .env files.");
    }

    const sanitizedBaseUrl = baseUrl ? baseUrl.replace(/\/$/, "").trim() : "";
    const backendEndpoint = `${sanitizedBaseUrl}/api/templates?type=${encodeURIComponent(type)}`;
    
    console.log(`[Template API] Fetching templates from ${backendEndpoint}`);

    try {
      const response = await fetch(backendEndpoint, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'X-Machine-Token': token || '',
          "User-Agent": "Roambooth-Machine/1.0",
        },
        signal: AbortSignal.timeout(30000),
      });

      const data = await response.json();
      if (!response.ok) {
        return NextResponse.json(data, { status: response.status });
      }

      return NextResponse.json({
        success: true,
        data: data.data || [],
        base_url: sanitizedBaseUrl
      });
    } catch (e: any) {
      console.error(`[Template API] Failed to reach ${backendEndpoint}:`, e.message);
      return NextResponse.json({ success: false, message: 'Gagal menghubungi server template potopi.' }, { status: 504 });
    }

  } catch (error) {
    console.error('Template Fetch Error:', error);
    return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
  }
}
