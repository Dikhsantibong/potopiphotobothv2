import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

function parseEnvContent(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.substring(0, eqIndex).trim();
    const value = trimmed.substring(eqIndex + 1).trim();
    env[key] = value;
  }
  return env;
}

function buildEnvContent(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n') + '\n';
}

function getEnvPath(): string {
  const cwdEnv = path.resolve(process.cwd(), '.env');
  if (require('fs').existsSync(cwdEnv)) {
    console.log(`[Env API] Using mutable path: ${cwdEnv}`);
    return cwdEnv;
  }
  
  // Fallback to reading the locked internal ASAR configuration if nothing has been saved yet
  const fallbackEnv = path.resolve(process.env.ELECTRON_APP_ROOT || process.cwd(), '.env');
  console.log(`[Env API] Using fallback internal path: ${fallbackEnv}`);
  return fallbackEnv;
}

export async function GET() {
  try {
    const envPath = getEnvPath();
    const content = await fs.readFile(envPath, 'utf-8');
    const env = parseEnvContent(content);

    return NextResponse.json({
      success: true,
      data: env
    });
  } catch (error) {
    console.error('Error reading .env:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to read .env file' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { env: newEnv } = body as { env: Record<string, string> };

    if (!newEnv || typeof newEnv !== 'object') {
      return NextResponse.json(
        { success: false, message: 'Invalid payload' },
        { status: 400 }
      );
    }

    const envPath = getEnvPath();

    // Read existing .env to preserve any keys not sent
    let existingEnv: Record<string, string> = {};
    try {
      const content = await fs.readFile(envPath, 'utf-8');
      existingEnv = parseEnvContent(content);
    } catch {
      // .env doesn't exist yet, that's okay
    }

    // Merge: overwrite existing with new values
    const merged = { ...existingEnv, ...newEnv };
    const newContent = buildEnvContent(merged);

    await fs.writeFile(envPath, newContent, 'utf-8');

    return NextResponse.json({
      success: true,
      message: '.env updated successfully. Restart the app for changes to take effect.',
      data: merged
    });
  } catch (error) {
    console.error('Error writing .env:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to write .env file: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
