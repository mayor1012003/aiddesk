/**
 * AidDesk — Electron Main Process Entry Point
 * 
 * Initializes the application window, database, device identity,
 * IPC handlers, and signaling server connection.
 */

const { app, BrowserWindow, ipcMain, desktopCapturer, screen } = require('electron');
const path = require('path');
const { initDatabase } = require('./database');
const { getOrCreateDeviceId } = require('./deviceId');
const { registerIpcHandlers } = require('./ipcHandlers');

// Keep a global reference to prevent garbage collection
let mainWindow = null;

// Environment config with defaults
const SIGNALING_URL = process.env.SIGNALING_SERVER_URL || 'ws://localhost:9090';
const INACTIVITY_TIMEOUT = parseInt(process.env.INACTIVITY_TIMEOUT || '10', 10);

function createMainWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1280, width),
    height: Math.min(800, height),
    minWidth: 900,
    minHeight: 600,
    title: 'AidDesk',
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,      // Security: isolate renderer from Node
      nodeIntegration: false,       // Security: no Node in renderer
      sandbox: false,               // Needed for preload access
      webSecurity: true,
    },
    show: false, // Show after ready-to-show to avoid white flash
  });

  // Load the React app (webpack output)
  const rendererPath = path.join(__dirname, '../../dist/renderer/index.html');
  mainWindow.loadFile(rendererPath).catch((err) => {
    console.error('Failed to load renderer:', err.message);
    // Fallback: try loading from dev server if running
    mainWindow.loadURL('http://localhost:8080').catch(() => {
      console.error('No renderer available. Run: npm run dev');
    });
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

async function bootstrap() {
  // Initialize SQLite database (creates tables if needed)
  const db = initDatabase();

  // Generate or retrieve persistent device ID
  const deviceId = getOrCreateDeviceId();
  console.log(`[AidDesk] Device ID: ${deviceId}`);

  // Create the application window
  const win = createMainWindow();

  // Register all IPC handlers (bridges renderer <-> main process)
  registerIpcHandlers({
    mainWindow: win,
    db,
    deviceId,
    signalingUrl: SIGNALING_URL,
    inactivityTimeout: INACTIVITY_TIMEOUT,
  });

  console.log('[AidDesk] Application ready');
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────

app.whenReady().then(bootstrap);

app.on('window-all-closed', () => {
  // On macOS, apps stay in dock until explicitly quit
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // macOS: re-create window when dock icon clicked and no windows open
  if (BrowserWindow.getAllWindows().length === 0) {
    bootstrap();
  }
});

// Security: prevent new window creation from renderer
app.on('web-contents-created', (_, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});
