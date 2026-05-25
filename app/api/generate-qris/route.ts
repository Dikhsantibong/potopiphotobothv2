import { NextResponse } from 'next/server';
import crypto from 'crypto';

export async function POST(request: Request) {
  try {
    const { amount, canvas_type, server_key, client_key, gateway_name, is_production } = await request.json();

    if (gateway_name === 'Doku') {
      return handleDoku(amount, server_key, client_key, is_production);
    } else {
      // Default / fallback to Midtrans
      return handleMidtrans(amount, canvas_type, server_key, is_production);
    }

  } catch (error) {
    console.error('QRIS Generation Error:', error);
    return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
  }
}

// ── Midtrans Handler ──────────────────────────────────────
async function handleMidtrans(amount: number, canvas_type: string, server_key: string, is_production: boolean) {
  if (!server_key) {
    return NextResponse.json({ success: false, message: 'Midtrans Server Key is required' }, { status: 400 });
  }

  const midtransUrl = is_production 
    ? 'https://app.midtrans.com/snap/v1/transactions' 
    : 'https://app.sandbox.midtrans.com/snap/v1/transactions';

  const orderId = `ROAM-${Date.now()}`;

  const response = await fetch(midtransUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Basic ${Buffer.from(server_key + ':').toString('base64')}`,
    },
    body: JSON.stringify({
      transaction_details: {
        order_id: orderId,
        gross_amount: Math.round(amount),
      },
      enabled_payments: ["gopay", "qris"],
      custom_field1: canvas_type,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Midtrans Snap Error:', data);
    return NextResponse.json({ 
      success: false, 
      message: 'Midtrans: ' + (data.error_messages ? data.error_messages[0] : 'Gagal membuat Snap URL') 
    }, { status: response.status || 500 });
  }

  // Snap API mengembalikan token dan redirect_url
  return NextResponse.json({
    success: true,
    data: {
      order_id: orderId,
      qr_string: null,
      qr_image_url: data.redirect_url, // Kita menyisipkan Snap URL ke property image
      amount: Math.round(amount),
      status: 'pending',
      is_iframe: true // Penanda khusus agar frontend merender iframe
    }
  });
}

// ── Doku Handler (Jokul V2 Direct API) ────────────────────
async function handleDoku(amount: number, server_key: string, client_key: string, is_production: boolean) {
  if (!server_key || !client_key) {
    return NextResponse.json({ success: false, message: 'Doku Client ID and Secret are required' }, { status: 400 });
  }

  const baseUrl = is_production ? 'https://api.doku.com' : 'https://api-sandbox.doku.com';
  const targetPath = '/qris-mpm/v1/generate-qr';
  const url = `${baseUrl}${targetPath}`;

  const requestId = `REQ-${Date.now()}`;
  const timestamp = new Date().toISOString().split('.')[0] + 'Z'; // Doku expects YYYY-MM-DDTHH:mm:ssZ
  
  const body = {
    order: {
      invoice_number: `INV-${Date.now()}`,
      amount: amount
    }
  };

  const bodyString = JSON.stringify(body);
  const digest = crypto.createHash('sha256').update(bodyString).digest('base64');
  
  const signatureString = `Client-Id:${client_key}\n` +
                          `Request-Id:${requestId}\n` +
                          `Request-Timestamp:${timestamp}\n` +
                          `Request-Target:${targetPath}\n` +
                          `Digest:${digest}`;

  const signature = crypto.createHmac('sha256', server_key)
                          .update(signatureString)
                          .digest('base64');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Client-Id': client_key,
      'Request-Id': requestId,
      'Request-Timestamp': timestamp,
      'Signature': `HMACSHA256=${signature}`,
      'Content-Type': 'application/json'
    },
    body: bodyString
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Doku Error:', data);
    return NextResponse.json({ success: false, message: data.message || 'Gagal membuat QRIS di Doku' }, { status: response.status || 500 });
  }

  return NextResponse.json({
    success: true,
    data: {
      order_id: data.order.invoice_number,
      qr_string: data.qr_string,
      qr_image_url: null, // Doku provides string only, frontend renders it
      amount: data.order.amount,
      status: 'pending',
      is_iframe: false
    }
  });
}