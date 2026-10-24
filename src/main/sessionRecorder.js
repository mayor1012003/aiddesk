/**
 * Session Recorder — Record remote desktop sessions as .webm files.
 * 
 * Uses the renderer's MediaRecorder API (invoked via IPC) to record
 * the incoming video stream. The main process handles file I/O
 * for saving the recording.
 * 
 * Note: Actual MediaRecorder runs in the renderer (browser context).
 * This module handles the file management side.
 */

const fs = require('fs');
const path = require('path');
const { app, dialog } = require('electron');

let currentRecordingPath = null;
let writeStream = null;

/**
 * Get the default recordings directory.
 */
function getRecordingsDir() {
  const customDir = process.env.RECORDING_DIR;
  if (customDir && fs.existsSync(customDir)) return customDir;

  const dir = path.join(app.getPath('videos'), 'AidDesk Recordings');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Start a new recording session.
 * @param {string} remoteDeviceId - Remote device ID for the filename
 * @returns {string} Path where the recording will be saved
 */
function startRecording(remoteDeviceId) {
  const dir = getRecordingsDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `session-${remoteDeviceId}-${timestamp}.webm`;
  currentRecordingPath = path.join(dir, fileName);

  writeStream = fs.createWriteStream(currentRecordingPath);
  console.log('[SessionRecorder] Recording started:', currentRecordingPath);

  return currentRecordingPath;
}

/**
 * Write a chunk of recorded data.
 * @param {Buffer} chunk - Recorded video data
 */
function writeChunk(chunk) {
  if (writeStream && !writeStream.destroyed) {
    writeStream.write(Buffer.from(chunk));
  }
}

/**
 * Stop and finalize the current recording.
 * @returns {string|null} Final file path, or null if not recording
 */
function stopRecording() {
  if (writeStream) {
    writeStream.end();
    writeStream = null;
    console.log('[SessionRecorder] Recording saved:', currentRecordingPath);
    const savedPath = currentRecordingPath;
    currentRecordingPath = null;
    return savedPath;
  }
  return null;
}

/**
 * Check if a recording is in progress.
 */
function isRecording() {
  return writeStream !== null && !writeStream.destroyed;
}

/**
 * Let user choose recording directory.
 */
async function chooseRecordingDir() {
  const result = await dialog.showOpenDialog({
    title: 'Choose recordings folder',
    properties: ['openDirectory'],
    defaultPath: getRecordingsDir(),
  });
  return result.canceled ? null : result.filePaths[0];
}

module.exports = {
  startRecording,
  writeChunk,
  stopRecording,
  isRecording,
  getRecordingsDir,
  chooseRecordingDir,
};
