/**
 * File Transfer — Chunked file transfer over WebRTC DataChannel.
 * 
 * Sends/receives files in 64KB chunks, supporting pause/resume.
 * File metadata is sent first, followed by binary chunks.
 * The host can block file transfer per-session via permissions.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, dialog } = require('electron');

const CHUNK_SIZE = 64 * 1024; // 64KB chunks

// Active transfers tracking
const activeTransfers = new Map();

/**
 * Initiate sending a file. Reads file and prepares chunk iterator.
 * @param {string} filePath - Absolute path to the file to send
 * @returns {object} Transfer metadata for the recipient
 */
function prepareFileForSending(filePath) {
  const stats = fs.statSync(filePath);
  const transferId = crypto.randomUUID();

  const transfer = {
    id: transferId,
    fileName: path.basename(filePath),
    fileSize: stats.size,
    filePath,
    totalChunks: Math.ceil(stats.size / CHUNK_SIZE),
    currentChunk: 0,
    status: 'ready',
  };

  activeTransfers.set(transferId, transfer);

  // Return metadata to send to remote peer
  return {
    type: 'file-metadata',
    transferId,
    fileName: transfer.fileName,
    fileSize: transfer.fileSize,
    totalChunks: transfer.totalChunks,
  };
}

/**
 * Read the next chunk of a file transfer.
 * @param {string} transferId
 * @returns {{ chunk: Buffer, index: number, done: boolean } | null}
 */
function readNextChunk(transferId) {
  const transfer = activeTransfers.get(transferId);
  if (!transfer || transfer.status === 'complete') return null;

  const fd = fs.openSync(transfer.filePath, 'r');
  const buffer = Buffer.alloc(CHUNK_SIZE);
  const offset = transfer.currentChunk * CHUNK_SIZE;
  const bytesRead = fs.readSync(fd, buffer, 0, CHUNK_SIZE, offset);
  fs.closeSync(fd);

  const chunk = buffer.slice(0, bytesRead);
  const index = transfer.currentChunk;
  transfer.currentChunk++;

  const done = transfer.currentChunk >= transfer.totalChunks;
  if (done) {
    transfer.status = 'complete';
  }

  return { chunk, index, done };
}

/**
 * Handle receiving a file: create write stream and accumulate chunks.
 * @param {object} metadata - File metadata from sender
 * @param {string} savePath - Directory to save the file
 * @returns {object} Receiver transfer state
 */
function beginReceivingFile(metadata, savePath) {
  const destPath = path.join(savePath, metadata.fileName);

  // Avoid overwriting: append number if file exists
  let finalPath = destPath;
  let counter = 1;
  while (fs.existsSync(finalPath)) {
    const ext = path.extname(metadata.fileName);
    const base = path.basename(metadata.fileName, ext);
    finalPath = path.join(savePath, `${base} (${counter})${ext}`);
    counter++;
  }

  const writeStream = fs.createWriteStream(finalPath);

  const transfer = {
    id: metadata.transferId,
    fileName: metadata.fileName,
    fileSize: metadata.fileSize,
    totalChunks: metadata.totalChunks,
    receivedChunks: 0,
    savePath: finalPath,
    writeStream,
    status: 'receiving',
  };

  activeTransfers.set(metadata.transferId, transfer);
  return transfer;
}

/**
 * Write a received chunk to disk.
 * @param {string} transferId
 * @param {Buffer} chunk
 * @param {number} index
 * @returns {{ progress: number, done: boolean }}
 */
function writeReceivedChunk(transferId, chunk, index) {
  const transfer = activeTransfers.get(transferId);
  if (!transfer || !transfer.writeStream) {
    return { progress: 0, done: false };
  }

  transfer.writeStream.write(chunk);
  transfer.receivedChunks++;

  const progress = transfer.receivedChunks / transfer.totalChunks;
  const done = transfer.receivedChunks >= transfer.totalChunks;

  if (done) {
    transfer.writeStream.end();
    transfer.status = 'complete';
  }

  return { progress, done };
}

/**
 * Cancel an active transfer.
 */
function cancelTransfer(transferId) {
  const transfer = activeTransfers.get(transferId);
  if (transfer) {
    if (transfer.writeStream) {
      transfer.writeStream.end();
    }
    transfer.status = 'cancelled';
    activeTransfers.delete(transferId);
  }
}

/**
 * Show a save dialog for choosing where to receive files.
 * @returns {Promise<string|null>} Selected directory path or null
 */
async function chooseSaveDirectory() {
  const result = await dialog.showOpenDialog({
    title: 'Choose download folder',
    properties: ['openDirectory'],
    defaultPath: app.getPath('downloads'),
  });
  return result.canceled ? null : result.filePaths[0];
}

/**
 * Show an open dialog for selecting a file to send.
 * @returns {Promise<string|null>} Selected file path or null
 */
async function chooseFileToSend() {
  const result = await dialog.showOpenDialog({
    title: 'Choose file to send',
    properties: ['openFile'],
  });
  return result.canceled ? null : result.filePaths[0];
}

module.exports = {
  prepareFileForSending,
  readNextChunk,
  beginReceivingFile,
  writeReceivedChunk,
  cancelTransfer,
  chooseSaveDirectory,
  chooseFileToSend,
  CHUNK_SIZE,
};
