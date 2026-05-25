import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';

const execAsync = promisify(exec);

async function printImageLocal(imagePath: string, printerName: string, orientation: string = "landscape") {
    // orientation: "landscape" = DNP (putar portrait→landscape), "portrait" = Epson (cetak sesuai template)
    const shouldRotate = orientation !== "portrait";
    let script = `
        if ('${printerName}' -ne '') {
            $printer = Get-WmiObject Win32_Printer -Filter "Name='${printerName}'"
            if (-not $printer) {
                Write-Error "Printer '${printerName}' not found or not connected."
                exit 1
            }
            if ($printer.WorkOffline -eq $true) {
                Write-Error "Printer '${printerName}' is Offline or disconnected."
                exit 1
            }
            if ($printer.PrinterStatus -eq 1 -or $printer.PrinterStatus -eq 2) {
                Write-Error "Printer is in an Error state ($($printer.PrinterStatus))."
                exit 1
            }
        }
        
        Add-Type -AssemblyName System.Drawing
        $img = [System.Drawing.Image]::FromFile('${imagePath}')
        
        # Log resolution for debugging
        # Write-Output "Original Size: $($img.Width)x$($img.Height)"

        $pd = New-Object System.Drawing.Printing.PrintDocument
        if ('${printerName}' -ne '') {
            $pd.PrinterSettings.PrinterName = '${printerName}'
        }

        # Rotasi: hanya aktif jika mode DNP (landscape) dan gambar portrait
        ${shouldRotate ? `if ($img.Width -lt $img.Height) {
            $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone)
        }` : '# Mode Epson Portrait - tidak memutar gambar'}

        # Set orientation to match the driver's default
        $pd.DefaultPageSettings.Landscape = $false

        $printHandler = {
            param($sender, $e)
            
            # Set high-quality rendering to prevent pixelation
            $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $e.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $e.Graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

            # Draw to the visible area to avoid clipping
            $e.Graphics.DrawImage($img, $e.Graphics.VisibleClipBounds)
        }
        $pd.add_PrintPage($printHandler)
        
        $pd.Print()
        $img.Dispose()
    `;
    
    const tempPs1 = path.join(os.tmpdir(), `print_script_${Date.now()}_${Math.floor(Math.random() * 1000)}.ps1`);
    fs.writeFileSync(tempPs1, script);
    
    try {
        const { stdout, stderr } = await execAsync(`powershell -ExecutionPolicy Bypass -File "${tempPs1}"`);
        if (stderr && stderr.trim().length > 0) {
            throw new Error(stderr.trim());
        }
    } finally {
        try { fs.unlinkSync(tempPs1); } catch (e) {}
    }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = process.env.TOKEN;
    const baseUrl = process.env.BASE_URL?.replace(/\/$/, '');

    if (!token || !baseUrl) {
      return NextResponse.json({ success: false, message: 'Server configuration error' }, { status: 500 });
    }

    const { id } = await params;
    const body = await request.json();

    const { image_data, images_data, printer_name, printer_orientation, copies = 1, ...remoteBody } = body;
    const orientation = printer_orientation || 'landscape'; // Default DNP (backward-compatible)
    let imagesToPrint: string[] = [];

    if (image_data) imagesToPrint.push(image_data);
    if (images_data && Array.isArray(images_data)) imagesToPrint = imagesToPrint.concat(images_data);

    if (imagesToPrint.length > 0) {
      const tempDir = os.tmpdir();
      for (let i = 0; i < imagesToPrint.length; i++) {
        const base64Data = imagesToPrint[i].replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const tempFilePath = path.join(tempDir, `print_temp_${Date.now()}_${i}.jpg`);
        
        fs.writeFileSync(tempFilePath, buffer);
        try {
          // Loop based on number of copies for each image
          for (let c = 0; c < Number(copies); c++) {
            await printImageLocal(tempFilePath, printer_name || '', orientation);
            if (c < Number(copies) - 1) {
              await new Promise(r => setTimeout(r, 2000)); // Delay between copies
            }
          }
        } catch (printErr: any) {
          console.error('Local printing failed:', printErr);
          try { fs.unlinkSync(tempFilePath); } catch (e) {}
          return NextResponse.json({ success: false, message: 'Hardware Error: ' + printErr.message }, { status: 400 });
        } finally {
          try { fs.unlinkSync(tempFilePath); } catch (e) {}
        }
      }
    } else {
        console.warn("No 'image_data' or 'images_data' provided for local printing. Skipping physical print.");
    }

    // Log to remote server (best-effort, don't block print success)
    let remoteData: any = { success: true, message: 'Printed locally' };
    try {
      remoteBody.printer_name = printer_name;
      const response = await fetch(`${baseUrl}/api/final-images/${id}/print`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Machine-Token': token,
        },
        body: JSON.stringify(remoteBody),
      });
      remoteData = await response.json();
    } catch (remoteErr) {
      console.warn('Remote print logging failed (non-blocking):', remoteErr);
    }

    return NextResponse.json({ success: true, ...remoteData }, { status: 200 });

  } catch (error) {
    console.error('Print API Error:', error);
    return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
  }
}

