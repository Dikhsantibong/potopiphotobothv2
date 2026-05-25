import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

function saveBase64ToFile(base64: string, filePath: string): boolean {
  try {
    const matches = base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) return false;
    const buffer = Buffer.from(matches[2], 'base64');
    fs.writeFileSync(filePath, buffer);
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { transaction_id } = body;

    if (!transaction_id) {
      return NextResponse.json({ success: false, message: 'Missing transaction_id' }, { status: 400 });
    }

    // Buat folder per transaksi di Pictures/RoamBooth_Backups/{transaction_id}
    const baseDir = path.join(os.homedir(), 'Pictures', 'RoamBooth_Backups');
    const txDir = path.join(baseDir, String(transaction_id));
    if (!fs.existsSync(txDir)) {
      fs.mkdirSync(txDir, { recursive: true });
    }

    const savedFiles: string[] = [];

    // 1. Simpan Final Image
    if (body.finalImageBase64) {
      if (saveBase64ToFile(body.finalImageBase64, path.join(txDir, 'final_image.jpg'))) {
        savedFiles.push('final_image.jpg');
      }
    }
    // Backward compatibility: field lama "imageBase64"
    if (body.imageBase64 && !body.finalImageBase64) {
      if (saveBase64ToFile(body.imageBase64, path.join(txDir, 'final_image.jpg'))) {
        savedFiles.push('final_image.jpg');
      }
    }

    // 2. Simpan Raw Photos (mentahan per frame)
    if (body.rawPhotos && Array.isArray(body.rawPhotos)) {
      body.rawPhotos.forEach((photo: string, index: number) => {
        if (photo) {
          if (saveBase64ToFile(photo, path.join(txDir, `raw_photo_${index + 1}.jpg`))) {
            savedFiles.push(`raw_photo_${index + 1}.jpg`);
          }
        }
      });
    }

    // 3. Simpan Captured Photos (foto setelah filter)
    if (body.capturedPhotos && Array.isArray(body.capturedPhotos)) {
      body.capturedPhotos.forEach((photo: string, index: number) => {
        if (photo) {
          if (saveBase64ToFile(photo, path.join(txDir, `captured_photo_${index + 1}.jpg`))) {
            savedFiles.push(`captured_photo_${index + 1}.jpg`);
          }
        }
      });
    }

    // 4. Simpan Video (dikirim sebagai base64 dari client)
    if (body.videoBase64) {
      try {
        // Video bisa dikirim sebagai data URL atau raw base64
        let videoBuffer: Buffer;
        if (body.videoBase64.startsWith('data:')) {
          const matches = body.videoBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
          videoBuffer = Buffer.from(matches![2], 'base64');
        } else {
          videoBuffer = Buffer.from(body.videoBase64, 'base64');
        }
        const ext = body.videoBase64.includes('mp4') ? 'mp4' : 'webm';
        fs.writeFileSync(path.join(txDir, `live_video.${ext}`), videoBuffer);
        savedFiles.push(`live_video.${ext}`);
      } catch (videoErr) {
        console.error('[save-failed-task] Failed to save video:', videoErr);
      }
    }

    // 5. Simpan metadata info
    const metadata = {
      transaction_id,
      template_id: body.template_id || null,
      saved_at: new Date().toISOString(),
      files: savedFiles,
    };
    fs.writeFileSync(path.join(txDir, 'info.json'), JSON.stringify(metadata, null, 2));

    console.log(`[save-failed-task] Saved ${savedFiles.length} files for transaction ${transaction_id} to ${txDir}`);

    return NextResponse.json({ success: true, message: `Saved ${savedFiles.length} files`, path: txDir }, { status: 200 });
  } catch (error) {
    console.error('[API/save-failed-task] Error saving photos:', error);
    return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
  }
}
