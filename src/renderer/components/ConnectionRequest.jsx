/**
 * ConnectionRequest — Incoming connection approval dialog.
 * 
 * Shown when a remote device requests to connect.
 * The local user can accept or deny the connection.
 * Auto-denies after 30 seconds if no response.
 */

import React, { useState, useEffect } from 'react';

export default function ConnectionRequest({ request, onRespond }) {
  const [countdown, setCountdown] = useState(30);

  useEffect(() => {
    if (!request) return;

    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          // Auto-deny
          onRespond?.(request?.requestId, false);
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [request, onRespond]);

  if (!request) return null;

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-title">
          🔔 Incoming Connection Request
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: 12 }}>
            Device <strong style={{ color: 'var(--accent)' }}>{request?.remoteDeviceId ?? 'Unknown'}</strong> wants to connect to your computer.
          </p>
          <p>
            They will be able to see your screen and control your mouse and keyboard.
          </p>
          <p style={{ marginTop: 12, color: 'var(--text-muted)', fontSize: 12 }}>
            Auto-denying in {countdown} seconds…
          </p>
        </div>
        <div className="modal-actions">
          <button
            className="btn btn-danger"
            onClick={() => onRespond?.(request?.requestId, false)}
          >
            ❌ Deny
          </button>
          <button
            className="btn btn-success"
            onClick={() => onRespond?.(request?.requestId, true)}
          >
            ✅ Accept
          </button>
        </div>
      </div>
    </div>
  );
}
