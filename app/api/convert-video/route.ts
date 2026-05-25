import { execFile } from "child_process"
import util from "util"
import path from "path"
import fs from "fs"
import os from "os"

const execFileAsync = util.promisify(execFile)

// Multi-layered path resolution for ffmpeg.exe
let absoluteFfmpegPath = ""
const possiblePaths = [
  // 1. Production Electron relative to launcher executable (process.cwd() = win-unpacked)
  path.join(process.cwd(), "resources", "app.asar.unpacked", "node_modules", "ffmpeg-static", "ffmpeg.exe"),
  // 2. Production Electron via injected var (if available)
  process.env.ELECTRON_APP_ROOT ? path.join(process.env.ELECTRON_APP_ROOT.replace(/app\.asar/i, "app.asar.unpacked"), "node_modules", "ffmpeg-static", "ffmpeg.exe") : "",
  // 3. Fallback based on Next.js server chunk location
  __dirname.includes("app.asar") ? path.join(__dirname.split("app.asar")[0], "app.asar.unpacked", "node_modules", "ffmpeg-static", "ffmpeg.exe") : "",
  // 4. Local Development
  path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg.exe")
]

for (const p of possiblePaths) {
  if (p && fs.existsSync(p)) {
    absoluteFfmpegPath = p
    break
  }
}

// MUST use os.tmpdir() because appRoot (app.asar) is Read-Only!
const tmpDir = path.join(os.tmpdir(), "roambooth-tmp")
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true })
}

export async function POST(req: Request) {
  let inputPath = ""
  let outputPath = ""

  try {
    const formData = await req.formData()
    const file = (formData.get("video") || formData.get("file")) as File

    if (!file) {
      return Response.json({ success: false, message: "No video file provided" }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const tempId = `${Date.now()}_${Math.floor(Math.random() * 10000)}`

    inputPath = path.join(tmpDir, `${tempId}.webm`)
    outputPath = path.join(tmpDir, `${tempId}.mp4`)

    fs.writeFileSync(inputPath, buffer)
    console.log(`[convert-video] Input: ${inputPath} (${buffer.length} bytes)`)

    if (!absoluteFfmpegPath) {
      throw new Error(`FFmpeg binary not found. Evaluated paths: ${possiblePaths.join(", ")}`);
    }

    // Using execFile securely passes arguments to the OS without cmd.exe space stripping
    const args = [
      "-y",
      "-i", inputPath,
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "28",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-an",
      "-vf", "scale='min(iw,720)':-2",
      outputPath
    ]
    
    console.log(`[convert-video] Executing: ${absoluteFfmpegPath} ${args.join(" ")}`)
    await execFileAsync(absoluteFfmpegPath, args, { timeout: 60000, maxBuffer: 10 * 1024 * 1024 })
    
    // Read the converted MP4
    const mp4Buffer = fs.readFileSync(outputPath)
    console.log(`[convert-video] Output: ${mp4Buffer.length} bytes`)

    // Cleanup
    try { fs.unlinkSync(inputPath) } catch { /* ignore */ }
    try { fs.unlinkSync(outputPath) } catch { /* ignore */ }

    return new Response(mp4Buffer, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": mp4Buffer.length.toString(),
        "X-Conversion-Success": "true",
      }
    })

  } catch (err: any) {
    console.error(`[convert-video] Conversion failed:`, err)
    if (inputPath) try { fs.unlinkSync(inputPath) } catch { /* ignore */ }
    if (outputPath) try { fs.unlinkSync(outputPath) } catch { /* ignore */ }
    return Response.json({ success: false, message: err.message }, { status: 500 })
  }
}