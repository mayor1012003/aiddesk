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
const background = require('./background');

// Keep a global reference to prevent garbage collection
let mainWindow = null;

// Environment config with defaults.
// Default: live Cloudflare Workers signaling server. Override with SIGNALING_SERVER_URL
// (e.g. ws://localhost:9090 when running ./signaling-server locally).
const SIGNALING_URL = process.env.SIGNALING_SERVER_URL || 'wss://aiddesk-signaling.mayor1012003.workers.dev';
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
      // Keep timers (signaling heartbeat/reconnect) running at full speed while the
      // window is hidden in the tray, so the device stays reachable.
      backgroundThrottling: false,
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

  const startHidden = background.wasLaunchedHidden();
  mainWindow.once('ready-to-show', () => {
    if (startHidden) {
      if (process.platform === 'darwin') app.dock?.hide?.();
      console.log('[AidDesk] Started at login — running in the tray');
    } else {
      mainWindow.show();
    }
  });

  // Closing the window keeps AidDesk running in the tray / menu bar so this device
  // stays reachable. Real quit: tray "Quit AidDesk", Cmd+Q, or an app update.
  mainWindow.on('close', (event) => {
    if (app.isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
    if (process.platform === 'darwin') app.dock?.hide?.();
  });

  // Open DevTools in development
  if ((process.env.NODE_ENV === 'development' || !app.isPackaged) && !startHidden) {
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

  // Tray / menu bar icon + start-at-login
  background.initBackground({ getWindow: () => mainWindow, deviceId });

  console.log('[AidDesk] Application ready');
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────

app.isQuitting = false;

// Single instance: a second launch (e.g. double-clicking the app again) just shows
// the already-running window instead of registering the same Device ID twice.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => background.showWindow());
  app.whenReady().then(bootstrap);
}

app.on('before-quit', () => {
  app.isQuitting = true; // tray Quit, Cmd+Q, auto-updater, OS shutdown
});

app.on('window-all-closed', () => {
  // The window is only hidden on close, so this fires only while quitting.
  if (app.isQuitting) app.quit();
});

app.on('activate', () => {
  // macOS: clicking the Dock / Launchpad icon shows the hidden window
  if (mainWindow) background.showWindow();
});

// Security: prevent new window creation from renderer
app.on('web-contents-created', (_, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});
