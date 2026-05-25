const https = require('https');

const data = JSON.stringify({
  payment_type: 'qris',
  transaction_details: {
    order_id: 'ROAM-' + Date.now(),
    gross_amount: 10000
  }
});

const req = https.request('https://api.sandbox.midtrans.com/v2/charge', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': 'Basic ' + Buffer.from('Mid-server-wTzM-FTs92Ph5DDEkDihrk7Q:').toString('base64')
  }
}, (res) => {
  let chunks = '';
  res.on('data', (d) => chunks += d);
  res.on('end', () => console.log(chunks));
});

req.on('error', (e) => console.error(e));
req.write(data);
req.end();
