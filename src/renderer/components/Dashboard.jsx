/**
 * Dashboard — Main landing screen.
 * 
 * Shows this device's ID prominently and provides a form to
 * connect to a remote device by entering their ID.
 */

import React, { useState } from 'react';

export default function Dashboard({ deviceId, connectionStatus, onConnect, onDisconnect }) {
  const [targetId, setTargetId] = useState('');
  const [error, setError] = useState('');

  const formatInput = (value) => {
    // Strip non-digits, then format as XXX-XXX-XXX
    const digits = value.replace(/\D/g, '').slice(0, 9);
    const parts = [];
    for (let i = 0; i < digits.length; i += 3) {
      parts.push(digits.slice(i, i + 3));
    }
    return parts.join('-');
  };

  const handleConnect = () => {
    const cleaned = targetId.replace(/\D/g, '');
    if (cleaned.length !== 9) {
      setError('Please enter a valid 9-digit Device ID');
      return;
    }
    setError('');
    onConnect?.(formatInput(targetId));
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleConnect();
  };

  const isConnected = connectionStatus === 'connected';
  const isConnecting = connectionStatus === 'connecting';

  return (
    <div className="dashboard">
      {/* Device ID Display */}
      <div className="device-id-card">
        <div className="device-id-label">Your Device ID</div>
        <div className="device-id-value">{deviceId || '---'}</div>
        <div className="device-id-hint">Share this ID so others can connect to your device</div>
      </div>

      {/* Connect to Remote Device */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>
          Enter a remote Device ID to connect
        </div>
        <div className="connect-form">
          <input
            className="connect-input"
            type="text"
            placeholder="XXX-XXX-XXX"
            value={targetId}
            onChange={(e) => setTargetId(formatInput(e.target.value))}
            onKeyDown={handleKeyDown}
            maxLength={11}
            disabled={isConnected || isConnecting}
          />
          {isConnected ? (
            <button className="btn btn-danger" onClick={onDisconnect}>
              ❌ Disconnect
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleConnect}
              disabled={isConnecting}
            >
              {isConnecting ? '⏳ Connecting…' : '→ Connect'}
            </button>
          )}
        </div>
        {error && (
          <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>
            {error}
          </div>
        )}
      </div>

      {/* Quick Info */}
      <div style={{
        display: 'flex', gap: 24, fontSize: 13, color: 'var(--text-muted)',
        marginTop: 20,
      }}>
        <div>🔒 End-to-end encrypted</div>
        <div>📱 Cross-platform</div>
        <div>⚡ Low latency</div>
      </div>
    </div>
  );
}
