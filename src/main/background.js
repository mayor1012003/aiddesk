/**
 * Background mode — keeps AidDesk running and reachable for remote support:
 *  - "Start AidDesk when I log in" (on by default in installed builds), launching hidden
 *  - System tray (Windows) / menu bar icon (macOS) with Device ID, status, Show, toggle, Quit
 *  - Native notification + window focus for incoming connection requests
 */

const { app, Tray, Menu, Notification, nativeImage } = require('electron');
const path = require('path');

const HIDDEN_ARG = '--hidden';

let Store;
try {
  Store = require('electron-store');
} catch {
  Store = null;
}
const store = Store ? new Store({ name: 'preferences', defaults: { startAtLogin: true } }) : null;

const STATUS_LABELS = {
  online: 'Online — ready for connections',
  connecting: 'Connecting to server…',
  offline: 'Offline — reconnecting…',
  replaced: 'Device ID in use elsewhere',
  session: 'In a remote session',
};

let tray = null;
let ctx = { getWindow: () => null, deviceId: '' };
let signalingStatus = 'connecting';

function assetPath(file) {
  // Packaged: electron-builder copies assets/ to <resources>/assets (extraResources)
  return app.isPackaged
    ? path.join(process.resourcesPath, 'assets', file)
    : path.join(__dirname, '../../assets', file);
}

/** True when the OS started us at login (or with --hidden): start in the tray, no window. */
function wasLaunchedHidden() {
  if (process.argv.includes(HIDDEN_ARG)) return true;
  if (process.platform === 'darwin') {
    try {
      const s = app.getLoginItemSettings();
      return Boolean(s.wasOpenedAtLogin || s.wasOpenedAsHidden);
    } catch {
      return false;
    }
  }
  return false;
}

function getStartAtLogin() {
  return store ? store.get('startAtLogin') !== false : true;
}

/** Register/unregister the login item. Only for installed builds — never register the dev Electron binary. */
function applyLoginItem(enabled) {
  if (!app.isPackaged) return false;
  try {
    if (process.platform === 'win32') {
      app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: [HIDDEN_ARG] });
    } else {
      app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true });
    }
    return true;
  } catch (err) {
    console.warn('[Background] Could not update login item:', err.message);
    return false;
  }
}

function setStartAtLogin(enabled) {
  const value = Boolean(enabled);
  store?.set('startAtLogin', value);
  applyLoginItem(value);
  refreshTray();
  return { enabled: value, applied: app.isPackaged };
}

function showWindow() {
  const win = ctx.getWindow();
  if (!win || win.isDestroyed()) return;
  if (process.platform === 'darwin') app.dock?.show?.();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (process.platform === 'darwin') app.focus({ steal: true });
}

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: `AidDesk — ID ${ctx.deviceId || '…'}`, enabled: false },
    { label: STATUS_LABELS[signalingStatus] || signalingStatus, enabled: false },
    { type: 'separator' },
    { label: 'Show AidDesk', click: showWindow },
    {
      label: 'Start AidDesk when I log in',
      type: 'checkbox',
      checked: getStartAtLogin(),
      enabled: app.isPackaged,
      click: (item) => setStartAtLogin(item.checked),
    },
    { type: 'separator' },
    { label: 'Quit AidDesk', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}

function refreshTray() {
  if (!tray || tray.isDestroyed()) return;
  tray.setToolTip(`AidDesk ${ctx.deviceId} — ${STATUS_LABELS[signalingStatus] || signalingStatus}`);
  tray.setContextMenu(buildMenu());
}

function createTray() {
  let image;
  if (process.platform === 'darwin') {
    image = nativeImage.createFromPath(assetPath('trayTemplate.png')); // @2x picked up automatically
    image.setTemplateImage(true);
  } else {
    image = nativeImage.createFromPath(assetPath(process.platform === 'win32' ? 'tray-32.png' : 'tray-16.png'));
    if (process.platform === 'win32') image = image.resize({ width: 16, height: 16 });
  }
  if (image.isEmpty()) image = nativeImage.createFromPath(assetPath('icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(image);
  if (process.platform !== 'darwin') tray.on('click', showWindow); // macOS: click opens the menu
  refreshTray();
  return tray;
}

function setSignalingStatus(status) {
  if (typeof status !== 'string' || status === signalingStatus) return;
  signalingStatus = status;
  refreshTray();
}

/** Bring the window forward and show a native notification for an incoming request. */
function notifyIncomingRequest(remoteDeviceId) {
  showWindow();
  try {
    if (Notification.isSupported()) {
      const n = new Notification({
        title: 'AidDesk — incoming connection',
        body: `Device ${remoteDeviceId} wants to connect. Open AidDesk to accept or deny.`,
      });
      n.on('click', showWindow);
      n.show();
    }
  } catch (err) {
    console.warn('[Background] Notification failed:', err.message);
  }
  const win = ctx.getWindow();
  if (win && !win.isDestroyed() && !win.isFocused()) win.flashFrame?.(true);
  return true;
}

/** Call once from app.whenReady(). */
function initBackground({ getWindow, deviceId }) {
  ctx = { getWindow, deviceId };
  applyLoginItem(getStartAtLogin()); // first run of an installed build: on by default
  createTray();
}

module.exports = {
  initBackground,
  wasLaunchedHidden,
  getStartAtLogin,
  setStartAtLogin,
  setSignalingStatus,
  notifyIncomingRequest,
  showWindow,
};
