import { NextResponse } from 'next/server';

const MIDTRANS_SANDBOX = 'https://api.sandbox.midtrans.com';
const MIDTRANS_PRODUCTION = 'https://api.midtrans.com';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get('order_id');
    const serverKey = searchParams.get('server_key');
    const prodFlag = searchParams.get('is_production');

    if (!orderId || !serverKey) {
      return NextResponse.json({ success: false, message: 'Missing order_id or server_key' }, { status: 400 });
    }

    const isProduction = prodFlag === '1' || prodFlag === 'true';
    const base = isProduction ? MIDTRANS_PRODUCTION : MIDTRANS_SANDBOX;
    const midtransUrl = `${base}/v2/${orderId}/status`;

    const response = await fetch(midtransUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Basic ${Buffer.from(serverKey + ':').toString('base64')}`,
      },
    });

    const data = await response.json();

    if (!response.ok || !['200', '201'].includes(data.status_code)) {
      // 404 means transaction not found (or not created yet at Midtrans side), we just say pending
      if (data.status_code === '404') {
        return NextResponse.json({
          success: true,
          data: { order_id: orderId, status: 'pending' }
        });
      }
      console.error('Midtrans Status Error:', data);
      return NextResponse.json({ success: false, message: 'Gagal mengecek status' }, { status: response.status || 500 });
    }

    // Menentukan apakah status "paid" (dibayar lunas)
    // Di Midtrans, transaction_status untuk sukses adalah "settlement" atau "capture"
    const isPaid = data.transaction_status === 'settlement' || data.transaction_status === 'capture';

    return NextResponse.json({
      success: true,
      data: {
        order_id: data.order_id,
        status: isPaid ? 'paid' : data.transaction_status, // Konversi ke format photobooth ("paid", "pending", "expire")
      }
    });

  } catch (error) {
    console.error('Check Status Error:', error);
    return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
  }
}
