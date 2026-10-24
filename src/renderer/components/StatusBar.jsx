/**
 * StatusBar — Connection status indicator in the header.
 * 
 * Shows the current connection state and session duration.
 */

import React, { useState, useEffect } from 'react';

export default function StatusBar({ connectionStatus, remoteDeviceId, sessionStartTime }) {
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

  const statusLabel = {
    disconnected: 'Disconnected',
    connecting: 'Connecting…',
    connected: `Connected to ${remoteDeviceId ?? 'remote'}`,
  };

  return (
    <div className="status-bar">
      <span className={`status-dot ${connectionStatus ?? 'disconnected'}`} />
      <span className="status-text">
        {statusLabel[connectionStatus] ?? 'Unknown'}
      </span>
      {connectionStatus === 'connected' && (
        <span className="status-text" style={{ fontFamily: 'monospace' }}>
          {elapsed}
        </span>
      )}
    </div>
  );
}
