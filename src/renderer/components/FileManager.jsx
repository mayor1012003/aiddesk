/**
 * FileManager — File transfer UI panel.
 * 
 * Allows sending and receiving files over WebRTC DataChannel.
 * Shows transfer progress and supports drag-and-drop.
 */

import React, { useState, useCallback } from 'react';

export default function FileManager({ fileChannel, onClose }) {
  const [transfers, setTransfers] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleSendFile = useCallback(async () => {
    const filePath = await window.aiddesk?.chooseFileToSend?.();
    if (!filePath) return;

    const metadata = await window.aiddesk?.prepareFile?.(filePath);
    if (!metadata) return;

    // Add to transfer list
    setTransfers((prev) => [...prev, {
      id: metadata.transferId,
      fileName: metadata.fileName,
      fileSize: metadata.fileSize,
      direction: 'outgoing',
      progress: 0,
      status: 'sending',
    }]);

    // Send metadata to remote peer
    if (fileChannel && fileChannel.readyState === 'open') {
      fileChannel.send(JSON.stringify(metadata));
    }

    // Send chunks
    const sendChunks = async () => {
      let done = false;
      while (!done) {
        const chunk = await window.aiddesk?.readNextChunk?.(metadata.transferId);
        if (!chunk) break;

        if (fileChannel && fileChannel.readyState === 'open') {
          // Send chunk index + data
          const header = JSON.stringify({ type: 'file-chunk', transferId: metadata.transferId, index: chunk.index, done: chunk.done });
          fileChannel.send(header);
          fileChannel.send(chunk.chunk);
        }

        done = chunk.done;
        const progress = (chunk.index + 1) / metadata.totalChunks;
        setTransfers((prev) => prev.map((t) =>
          t.id === metadata.transferId ? { ...t, progress, status: done ? 'complete' : 'sending' } : t
        ));
      }
    };

    sendChunks().catch(console.error);
  }, [fileChannel]);

  const formatSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
    // In Electron, dropped files have a .path property
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0 && files[0].path) {
      // Use the file path to prepare for sending
      window.aiddesk?.prepareFile?.(files[0].path).then((metadata) => {
        if (metadata) {
          setTransfers((prev) => [...prev, {
            id: metadata.transferId,
            fileName: metadata.fileName,
            fileSize: metadata.fileSize,
            direction: 'outgoing',
            progress: 0,
            status: 'ready',
          }]);
        }
      });
    }
  }, []);

  return (
    <div className="file-manager">
      <div className="file-manager-header">
        <h3 style={{ fontSize: 14, fontWeight: 600 }}>📁 File Transfer</h3>
        <button className="btn-icon" onClick={onClose}>✕</button>
      </div>

      {/* Drop Zone */}
      <div
        className="file-drop-zone"
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={handleSendFile}
        style={isDragOver ? { borderColor: 'var(--accent)', background: 'var(--accent-muted)' } : {}}
      >
        📤 Drop files here or click to browse
      </div>

      {/* Transfer List */}
      <div className="file-list">
        {(transfers ?? []).length === 0 && (
          <div className="empty-state" style={{ padding: 20, fontSize: 13 }}>
            No active transfers
          </div>
        )}
        {(transfers ?? []).map((t) => (
          <div key={t?.id} className="file-item">
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                {t?.direction === 'outgoing' ? '⬆️' : '⬇️'} {t?.fileName ?? 'Unknown'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                {formatSize(t?.fileSize)} — {t?.status ?? 'unknown'}
              </div>
              <div className="file-progress">
                <div
                  className="file-progress-bar"
                  style={{ width: `${(t?.progress ?? 0) * 100}%` }}
                />
              </div>
            </div>
            {t?.status !== 'complete' && (
              <button
                className="btn-icon"
                title="Cancel"
                onClick={() => window.aiddesk?.cancelTransfer?.(t?.id)}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
