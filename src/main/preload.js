/**
 * Preload Script — Secure contextBridge for AidDesk.
 * 
 * Exposes a controlled API surface to the renderer via window.aiddesk.
 * All communication between renderer and main process goes through
 * these IPC channels. No Node.js APIs are directly exposed.
 */

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Create a safe invoke wrapper with error handling.
 */
function safeInvoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args).catch((err) => {
    console.error(`[IPC Error] ${channel}:`, err.message);
    throw err;
  });
}

contextBridge.exposeInMainWorld('aiddesk', {
  // ─── Device Identity ─────────────────────────────────────────────────
  getDeviceId: () => safeInvoke('device:getId'),

  // ─── Signaling & WebRTC ──────────────────────────────────────────────
  getSignalingUrl: () => safeInvoke('signaling:getUrl'),
  getIceServers: () => safeInvoke('webrtc:getIceServers'),

  // ─── Screen Capture ──────────────────────────────────────────────────
  getScreenSources: () => safeInvoke('screen:getSources'),
  getCaptureConstraints: (sourceId, quality) =>
    safeInvoke('screen:getCaptureConstraints', sourceId, quality),
  getScreenDimensions: () => safeInvoke('screen:getDimensions'),

  // ─── Input Control ───────────────────────────────────────────────────
  handleInputEvent: (event) => safeInvoke('input:handle', event),
  setInputEnabled: (enabled) => safeInvoke('input:setEnabled', enabled),
  getInputEnabled: () => safeInvoke('input:getEnabled'),

  // ─── Authentication ─────────────────────────────────────────────────
  setPassword: (password) => safeInvoke('auth:setPassword', password),
  verifyPassword: (password) => safeInvoke('auth:verifyPassword', password),
  hasPassword: () => safeInvoke('auth:hasPassword'),
  removePassword: () => safeInvoke('auth:removePassword'),
  setup2FA: () => safeInvoke('auth:setup2FA'),
  verify2FASetup: (token) => safeInvoke('auth:verify2FASetup', token),
  verifyTOTP: (token) => safeInvoke('auth:verifyTOTP', token),
  is2FAEnabled: () => safeInvoke('auth:is2FAEnabled'),
  disable2FA: () => safeInvoke('auth:disable2FA'),
  checkLockout: (deviceId) => safeInvoke('auth:checkLockout', deviceId),
  isWhitelisted: (deviceId) => safeInvoke('auth:isWhitelisted', deviceId),
  addToWhitelist: (deviceId, notes) => safeInvoke('auth:addToWhitelist', deviceId, notes),
  removeFromWhitelist: (deviceId) => safeInvoke('auth:removeFromWhitelist', deviceId),
  getWhitelist: () => safeInvoke('auth:getWhitelist'),

  // ─── Connection Approval ─────────────────────────────────────────────
  onConnectionRequest: (callback) => {
    ipcRenderer.on('connection:request', (_, data) => callback(data));
  },
  respondToConnection: (requestId, accepted) =>
    safeInvoke('connection:respond', requestId, accepted),

  // ─── File Transfer ───────────────────────────────────────────────────
  chooseFileToSend: () => safeInvoke('file:chooseToSend'),
  chooseSaveDirectory: () => safeInvoke('file:chooseSaveDir'),
  prepareFile: (filePath) => safeInvoke('file:prepare', filePath),
  readNextChunk: (transferId) => safeInvoke('file:readChunk', transferId),
  beginReceiving: (metadata, savePath) => safeInvoke('file:beginReceive', metadata, savePath),
  writeChunk: (transferId, chunk, index) => safeInvoke('file:writeChunk', transferId, chunk, index),
  cancelTransfer: (transferId) => safeInvoke('file:cancel', transferId),

  // ─── Session Recording ───────────────────────────────────────────────
  startRecording: (remoteDeviceId) => safeInvoke('recording:start', remoteDeviceId),
  writeRecordingChunk: (chunk) => safeInvoke('recording:writeChunk', chunk),
  stopRecording: () => safeInvoke('recording:stop'),
  isRecording: () => safeInvoke('recording:isActive'),

  // ─── Session History ─────────────────────────────────────────────────
  getSessions: (limit) => safeInvoke('sessions:getAll', limit),
  logSession: (data) => safeInvoke('sessions:log', data),

  // ─── Address Book ───────────────────────────────────────────────────
  getAddressBook: () => safeInvoke('addressBook:getAll'),
  addToAddressBook: (deviceId, alias, notes) =>
    safeInvoke('addressBook:add', deviceId, alias, notes),
  updateAddressBookEntry: (deviceId, alias, notes) =>
    safeInvoke('addressBook:update', deviceId, alias, notes),
  removeFromAddressBook: (deviceId) => safeInvoke('addressBook:remove', deviceId),

  // ─── Clipboard ─────────────────────────────────────────────────────
  getClipboard: () => safeInvoke('clipboard:get'),
  setClipboard: (text) => safeInvoke('clipboard:set', text),

  // ─── Event Listeners (main -> renderer) ─────────────────────────────
  onSessionEvent: (callback) => {
    ipcRenderer.on('session:event', (_, data) => callback(data));
  },
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
});
