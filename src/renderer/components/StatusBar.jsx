/**
 * StatusBar — Connection status indicator in the header.
 * 
 * Shows the active session state and duration; when there is no session it shows
 * whether this device is registered with the signaling server (i.e. reachable).
 */

import React, { useState, useEffect } from 'react';

// Server (signaling) status → [dot class, label]
const SIGNALING_DISPLAY = {
  online: ['connected', 'Online — ready for connections'],
  connecting: ['connecting', 'Connecting to server…'],
  offline: ['disconnected', 'Offline — reconnecting…'],
  replaced: ['disconnected', 'Device ID in use on another instance'],
};

export default function StatusBar({ connectionStatus, signalingStatus, remoteDeviceId, sessionStartTime }) {
  const [elapsed, setElapsed] = useState('00:00');

  useEffect(() => {
    if (connectionStatus !== 'connected' || !sessionStartTime) {
      setElapsed('00:00');
      return;
    }

    const interval = setInterval(() => {
      const diff = Math.floor((Date.now() - sessionStartTime) / 1000);
      const mins = Math.floor(diff / 60).toString().padStart(2, '0');
      const secs = (diff % 60).toString().padStart(2, '0');
      setElapsed(`${mins}:${secs}`);
    }, 1000);

    return () => clearInterval(interval);
  }, [connectionStatus, sessionStartTime]);

  const sessionLabel = {
    connecting: `Connecting to ${remoteDeviceId || 'remote'}…`,
    connected: `Connected to ${remoteDeviceId || 'remote'}`,
  };

  // An active/pending session takes priority over the server status.
  const [dotClass, label] = sessionLabel[connectionStatus]
    ? [connectionStatus, sessionLabel[connectionStatus]]
    : SIGNALING_DISPLAY[signalingStatus] ?? SIGNALING_DISPLAY.offline;

  return (
    <div className="status-bar" title={`Signaling server: ${signalingStatus ?? 'unknown'}`}>
      <span className={`status-dot ${dotClass}`} />
      <span className="status-text">{label}</span>
      {connectionStatus === 'connected' && (
        <span className="status-text" style={{ fontFamily: 'monospace' }}>
          {elapsed}
        </span>
      )}
    </div>
  );
}
