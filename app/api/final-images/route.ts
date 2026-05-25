import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const token = process.env.TOKEN;
    const baseUrl = process.env.BASE_URL?.replace(/\/$/, '');

    if (!token || !baseUrl) {
      return NextResponse.json({ success: false, message: 'Server configuration error' }, { status: 500 });
    }

    const formData = await request.formData();

    const response = await fetch(`${baseUrl}/api/final-images`, {
      method: 'POST',
      headers: {
        'X-Machine-Token': token,
        'Accept': 'application/json',
      },
      body: formData,
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error(`[API/final-images] Laravel returned ${response.status}:`, JSON.stringify(data));
    }
    
    return NextResponse.json(data, { status: response.status });

  } catch (error) {
    console.error('Final Image Upload Error:', error);
    return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
  }
}
