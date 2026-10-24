/**
 * IPC Handlers — Bridge between Electron main process and React renderer.
 * 
 * Registers all ipcMain.handle() channels that the preload script exposes.
 * This is the central nervous system of AidDesk's main process.
 */

const { ipcMain, clipboard } = require('electron');
const crypto = require('crypto');
const { getScreenSources, buildCaptureConstraints, getScreenDimensions } = require('./screenCapture');
const { handleInputEvent, setInputEnabled, isInputEnabled } = require('./inputControl');
const { AuthManager } = require('./auth');
const {
  prepareFileForSending,
  readNextChunk,
  beginReceivingFile,
  writeReceivedChunk,
  cancelTransfer,
  chooseSaveDirectory,
  chooseFileToSend,
} = require('./fileTransfer');
const {
  startRecording,
  writeChunk: writeRecordingChunk,
  stopRecording,
  isRecording,
} = require('./sessionRecorder');

// Pending connection requests (host-side interactive approval)
const pendingRequests = new Map();

/**
 * Register all IPC handlers.
 * @param {object} ctx - Application context { mainWindow, db, deviceId, signalingUrl, inactivityTimeout }
 */
function registerIpcHandlers(ctx) {
  const { mainWindow, db, deviceId, signalingUrl, inactivityTimeout } = ctx;
  const authManager = new AuthManager(db);

  // ─── Device Identity ─────────────────────────────────────────────────
  ipcMain.handle('device:getId', () => deviceId);

  // ─── Signaling & WebRTC Config ───────────────────────────────────────
  ipcMain.handle('signaling:getUrl', () => signalingUrl);

  ipcMain.handle('webrtc:getIceServers', () => {
    const servers = [];
    const stun = process.env.STUN_SERVERS || 'stun:stun.l.google.com:19302';
    stun.split(',').forEach((s) => servers.push({ urls: s.trim() }));

    const turn = process.env.TURN_SERVERS;
    if (turn) {
      turn.split(',').forEach((t) => {
        servers.push({
          urls: t.trim(),
          username: process.env.TURN_USERNAME || '',
          credential: process.env.TURN_CREDENTIAL || '',
        });
      });
    }
    return servers;
  });

  // ─── Screen Capture ──────────────────────────────────────────────────
  ipcMain.handle('screen:getSources', async () => getScreenSources());
  ipcMain.handle('screen:getCaptureConstraints', (_, sourceId, quality) =>
    buildCaptureConstraints(sourceId, quality)
  );
  ipcMain.handle('screen:getDimensions', () => getScreenDimensions());

  // ─── Input Control ───────────────────────────────────────────────────
  ipcMain.handle('input:handle', (_, event) => handleInputEvent(event));
  ipcMain.handle('input:setEnabled', (_, enabled) => setInputEnabled(enabled));
  ipcMain.handle('input:getEnabled', () => isInputEnabled());

  // ─── Authentication ─────────────────────────────────────────────────
  ipcMain.handle('auth:setPassword', (_, password) => authManager.setPassword(password));
  ipcMain.handle('auth:verifyPassword', (_, password) => authManager.verifyPassword(password));
  ipcMain.handle('auth:hasPassword', () => authManager.hasPassword());
  ipcMain.handle('auth:removePassword', () => authManager.removePassword());
  ipcMain.handle('auth:setup2FA', () => authManager.setup2FA(deviceId));
  ipcMain.handle('auth:verify2FASetup', (_, token) => authManager.verify2FASetup(token));
  ipcMain.handle('auth:verifyTOTP', (_, token) => authManager.verifyTOTP(token));
  ipcMain.handle('auth:is2FAEnabled', () => authManager.is2FAEnabled());
  ipcMain.handle('auth:disable2FA', () => authManager.disable2FA());
  ipcMain.handle('auth:checkLockout', (_, did) => authManager.checkLockout(did));
  ipcMain.handle('auth:isWhitelisted', (_, did) => authManager.isWhitelisted(did));
  ipcMain.handle('auth:addToWhitelist', (_, did, notes) => authManager.addToWhitelist(did, notes));
  ipcMain.handle('auth:removeFromWhitelist', (_, did) => authManager.removeFromWhitelist(did));
  ipcMain.handle('auth:getWhitelist', () => authManager.getWhitelist());

  // ─── Connection Approval (Interactive) ───────────────────────────────
  ipcMain.handle('connection:request-approval', (_, remoteDeviceId) => {
    return new Promise((resolve) => {
      const requestId = crypto.randomUUID();
      pendingRequests.set(requestId, resolve);

      // Send to renderer to show approval dialog
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('connection:request', {
          requestId,
          remoteDeviceId,
          timestamp: Date.now(),
        });

        // Auto-deny after 30 seconds if no response
        setTimeout(() => {
          if (pendingRequests.has(requestId)) {
            pendingRequests.delete(requestId);
            resolve(false);
          }
        }, 30_000);
      } else {
        resolve(false);
      }
    });
  });

  ipcMain.handle('connection:respond', (_, requestId, accepted) => {
    const resolve = pendingRequests.get(requestId);
    if (resolve) {
      pendingRequests.delete(requestId);
      resolve(accepted);
    }
    return true;
  });

  // ─── File Transfer ───────────────────────────────────────────────────
  ipcMain.handle('file:chooseToSend', () => chooseFileToSend());
  ipcMain.handle('file:chooseSaveDir', () => chooseSaveDirectory());
  ipcMain.handle('file:prepare', (_, filePath) => prepareFileForSending(filePath));
  ipcMain.handle('file:readChunk', (_, transferId) => {
    const result = readNextChunk(transferId);
    if (!result) return null;
    // Convert Buffer to ArrayBuffer for IPC transfer
    return {
      chunk: result.chunk.buffer.slice(
        result.chunk.byteOffset,
        result.chunk.byteOffset + result.chunk.byteLength
      ),
      index: result.index,
      done: result.done,
    };
  });
  ipcMain.handle('file:beginReceive', (_, metadata, savePath) =>
    beginReceivingFile(metadata, savePath)
  );
  ipcMain.handle('file:writeChunk', (_, transferId, chunk, index) =>
    writeReceivedChunk(transferId, Buffer.from(chunk), index)
  );
  ipcMain.handle('file:cancel', (_, transferId) => cancelTransfer(transferId));

  // ─── Session Recording ───────────────────────────────────────────────
  ipcMain.handle('recording:start', (_, remoteDeviceId) => startRecording(remoteDeviceId));
  ipcMain.handle('recording:writeChunk', (_, chunk) => writeRecordingChunk(chunk));
  ipcMain.handle('recording:stop', () => stopRecording());
  ipcMain.handle('recording:isActive', () => isRecording());

  // ─── Session History ─────────────────────────────────────────────────
  ipcMain.handle('sessions:getAll', (_, limit = 50) => {
    return db.prepare(
      'SELECT * FROM sessions ORDER BY start_time DESC LIMIT ?'
    ).all(limit);
  });

  ipcMain.handle('sessions:log', (_, data) => {
    const sessionId = data.sessionId || crypto.randomUUID();
    db.prepare(
      `INSERT INTO sessions (session_id, remote_device_id, direction, start_time, end_time, duration_seconds, disconnect_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sessionId,
      data.remoteDeviceId,
      data.direction || 'outgoing',
      data.startTime || new Date().toISOString(),
      data.endTime || null,
      data.durationSeconds || 0,
      data.disconnectReason || 'unknown'
    );
    return sessionId;
  });

  // ─── Address Book ───────────────────────────────────────────────────
  ipcMain.handle('addressBook:getAll', () => {
    return db.prepare('SELECT * FROM address_book ORDER BY last_connected DESC NULLS LAST, alias ASC').all();
  });

  ipcMain.handle('addressBook:add', (_, deviceIdVal, alias, notes) => {
    db.prepare(
      `INSERT INTO address_book (device_id, alias, notes, created_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(device_id) DO UPDATE SET alias = excluded.alias, notes = excluded.notes`
    ).run(deviceIdVal, alias || '', notes || '');
    return true;
  });

  ipcMain.handle('addressBook:update', (_, deviceIdVal, alias, notes) => {
    db.prepare(
      `UPDATE address_book SET alias = ?, notes = ? WHERE device_id = ?`
    ).run(alias || '', notes || '', deviceIdVal);
    return true;
  });

  ipcMain.handle('addressBook:remove', (_, deviceIdVal) => {
    db.prepare('DELETE FROM address_book WHERE device_id = ?').run(deviceIdVal);
    return true;
  });

  // ─── Clipboard Sync ─────────────────────────────────────────────────
  ipcMain.handle('clipboard:get', () => clipboard.readText());
  ipcMain.handle('clipboard:set', (_, text) => clipboard.writeText(text || ''));

  console.log('[IPC] All handlers registered');
}

module.exports = { registerIpcHandlers };
