import { execFile } from "child_process"
import util from "util"
import path from "path"
import fs from "fs"
import os from "os"

const execFileAsync = util.promisify(execFile)

// Resolusi path ffmpeg.exe — pola yang sama dengan /api/convert-video
let absoluteFfmpegPath = ""
const possiblePaths = [
  path.join(process.cwd(), "resources", "app.asar.unpacked", "node_modules", "ffmpeg-static", "ffmpeg.exe"),
  process.env.ELECTRON_APP_ROOT ? path.join(process.env.ELECTRON_APP_ROOT.replace(/app\.asar/i, "app.asar.unpacked"), "node_modules", "ffmpeg-static", "ffmpeg.exe") : "",
  __dirname.includes("app.asar") ? path.join(__dirname.split("app.asar")[0], "app.asar.unpacked", "node_modules", "ffmpeg-static", "ffmpeg.exe") : "",
  path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg.exe")
]

for (const p of possiblePaths) {
  if (p && fs.existsSync(p)) {
    absoluteFfmpegPath = p
    break
  }
}

const tmpDir = path.join(os.tmpdir(), "roambooth-tmp")
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true })
}

function cleanup(dir: string) {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    /* biarkan OS yang membersihkan */
  }
}

/**
 * Membuat GIF animasi dari beberapa foto frame photobooth.
 *
 * FormData:
 *   frames  : File (boleh berulang, urut sesuai urutan frame)
 *   delayMs : jeda antar frame dalam milidetik (default 500)
 *   width   : lebar GIF (default 480)
 */
export async function POST(req: Request) {
  const workDir = path.join(tmpDir, `gif_${Date.now()}_${Math.floor(Math.random() * 10000)}`)

  try {
    const formData = await req.formData()
    const frames = formData.getAll("frames").filter((f): f is File => f instanceof File)

    if (frames.length === 0) {
      return Response.json({ success: false, message: "Tidak ada frame yang dikirim" }, { status: 400 })
    }

    if (!absoluteFfmpegPath) {
      throw new Error(`FFmpeg binary tidak ditemukan. Path yang dicoba: ${possiblePaths.join(", ")}`)
    }

    const delayMs = Math.min(2000, Math.max(80, Number(formData.get("delayMs")) || 500))
    const width = Math.min(1080, Math.max(160, Number(formData.get("width")) || 480))

    fs.mkdirSync(workDir, { recursive: true })

    // ffmpeg butuh nama file berurutan (frame_001.jpg, frame_002.jpg, ...)
    for (let i = 0; i < frames.length; i++) {
      const buffer = Buffer.from(await frames[i].arrayBuffer())
      fs.writeFileSync(path.join(workDir, `frame_${String(i + 1).padStart(3, "0")}.jpg`), buffer)
    }

    const outputPath = path.join(workDir, "out.mp4")
    const framerate = (1000 / delayMs).toFixed(4)

    // Gunakan libx264 untuk menghasilkan MP4 yang bersih (jutaan warna) tanpa noise dithering.
    const args = [
      "-y",
      "-framerate", framerate,
      "-i", path.join(workDir, "frame_%03d.jpg"),
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-vf", `scale=${width}:-2`,
      outputPath
    ]

    console.log(`[make-gif] ${frames.length} frame, delay ${delayMs}ms, lebar ${width}px`)
    await execFileAsync(absoluteFfmpegPath, args, { timeout: 60000, maxBuffer: 10 * 1024 * 1024 })

    const gifBuffer = fs.readFileSync(outputPath)
    console.log(`[make-gif] Output: ${(gifBuffer.length / 1024).toFixed(0)} KB`)

    cleanup(workDir)

    return new Response(new Uint8Array(gifBuffer), {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": gifBuffer.length.toString(),
        "X-Gif-Success": "true",
      }
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[make-gif] Gagal membuat GIF:`, message)
    cleanup(workDir)
    return Response.json({ success: false, message }, { status: 500 })
  }
}
