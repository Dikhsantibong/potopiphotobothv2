const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const fs = require('fs');

const dev = !app.isPackaged;

// ── Manual .env Loading ──────────────────────────────────
// In production, Next.js might not load .env from the root folder correctly.
// We manually load it into process.env before preparing Next.js.
function loadEnv() {
  const root = __dirname;
  console.log(`> App Root Directory: ${root}`);
  
  // Use userData directory for the mutable .env file in production
  const userDataPath = app.getPath('userData');
  const mutableEnvPath = path.join(userDataPath, '.env');
  
  let envPath = mutableEnvPath;
  
  // If no mutable .env exists yet in userData
  if (!fs.existsSync(envPath)) {
     // Try project root (works in development)
     let fallbackPath = path.resolve(process.cwd(), '.env');
     
     if (!fs.existsSync(fallbackPath)) {
         // Fallback to baked-in ASAR configuration
         fallbackPath = path.resolve(root, '.env');
     }
     
     envPath = fallbackPath;
  }

  // Tell Next.js where it should save future .env updates
  process.env.MUTABLE_ENV_PATH = app.isPackaged ? mutableEnvPath : path.resolve(process.cwd(), '.env');

  
  if (fs.existsSync(envPath)) {
    console.log(`> Loading environment from: ${envPath}`);
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) return;
      const key = trimmed.substring(0, eqIndex).trim();
      const value = trimmed.substring(eqIndex + 1).trim();
      process.env[key] = value;
    });
  } else {
    console.warn(`> Warning: .env file not found at ${envPath}`);
  }
}

const hostname = 'localhost';
const port = 3000;

let nextApp;
let nextHandler;

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');
  console.log(`> Loading preload script from: ${preloadPath}`);
  
  if (!fs.existsSync(preloadPath)) {
    console.error(`> ERROR: Preload script NOT FOUND at ${preloadPath}`);
  }

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
    },
    // Mengaktifkan layar penuh permanen dan menyembunyikan menu bar
    fullscreen: true,
    autoHideMenuBar: true,
  });

  // Memuat server Next.js (baik dev maupun prod)
  win.loadURL(`http://${hostname}:${port}`);

  // Opsional: Buka DevTools secara otomatis
  // if (dev) win.webContents.openDevTools();
}

// ── IPC Handlers ──────────────────────────────────────────
ipcMain.on('restart-app', () => {
  console.log('> Restarting app...');
  app.relaunch();
  app.exit(0);
});

ipcMain.on('close-app', () => {
  console.log('> Closing app...');
  app.quit();
});

app.whenReady().then(async () => {
  // Load environment variables before starting Next.js
  loadEnv();

  if (!dev) {
    try {
      // Expose the true application root directory to Next.js API Routes 
      // so it can accurately find node_modules and tmp inside 'resources/app'
      process.env.ELECTRON_APP_ROOT = __dirname;

      // Di mode produksi, kita start server Next.js secara internal
      nextApp = next({ dev: false, dir: __dirname, hostname, port });
      nextHandler = nextApp.getRequestHandler();
      
      await nextApp.prepare();
      
      const server = createServer((req, res) => {
        try {
          const parsedUrl = parse(req.url, true);
          nextHandler(req, res, parsedUrl);
        } catch (err) {
          console.error('Error occurred handling', req.url, err);
          res.statusCode = 500;
          res.end('internal server error');
        }
      });
      
      server.listen(port, () => {
        console.log(`> Next.js Server ready on http://${hostname}:${port}`);
        createWindow();
      });
    } catch (err) {
      console.error('Next.js prepare failed:', err);
    }
  } else {
    // Di mode pengembangan, server dijalankan terpisah via concurrently
    createWindow();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

