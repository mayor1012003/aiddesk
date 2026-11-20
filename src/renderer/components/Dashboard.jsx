/**
 * Dashboard — Main landing screen.
 * 
 * Shows this device's ID prominently and provides a form to
 * connect to a remote device by entering their ID.
 */

import React, { useState } from 'react';

export default function Dashboard({ deviceId, connectionStatus, signalingStatus, notice, onConnect, onDisconnect }) {
  const [targetId, setTargetId] = useState('');
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');

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
    // Optional unattended-access password (+ 2FA code): connects without anyone clicking Accept
    onConnect?.(formatInput(targetId), { password: password || undefined, totp: totp.trim() || undefined });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleConnect();
  };

  const isConnected = connectionStatus === 'connected';
  const isConnecting = connectionStatus === 'connecting';
  const reachability = {
    online: { color: 'var(--success)', text: '● Online — others can connect to this device now' },
    connecting: { color: 'var(--warning)', text: '● Connecting to the signaling server…' },
    offline: { color: 'var(--danger)', text: '● Offline — retrying automatically' },
    replaced: { color: 'var(--danger)', text: '● This Device ID is active in another AidDesk window' },
  }[signalingStatus] ?? { color: 'var(--text-muted)', text: '' };

  return (
    <div className="dashboard">
      {/* Device ID Display */}
      <div className="device-id-card">
        <div className="device-id-label">Your Device ID</div>
        <div className="device-id-value">{deviceId || '---'}</div>
        <div className="device-id-hint">Share this ID so others can connect to your device</div>
        {reachability.text && (
          <div style={{ fontSize: 12, marginTop: 8, color: reachability.color }}>{reachability.text}</div>
        )}
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
        <div className="connect-form" style={{ marginTop: 10 }}>
          <input
            className="connect-input"
            type="password"
            placeholder="Unattended password (optional)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isConnected || isConnecting}
            style={{ fontSize: 14, letterSpacing: 'normal' }}
            autoComplete="off"
          />
          <input
            className="connect-input"
            type="text"
            inputMode="numeric"
            placeholder="2FA code"
            value={totp}
            onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={handleKeyDown}
            disabled={isConnected || isConnecting}
            style={{ fontSize: 14, letterSpacing: 'normal', width: 110 }}
            autoComplete="off"
          />
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
          Leave empty to ask the other person to click Accept.
        </div>
        {(error || notice) && (
          <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>
            {error || notice}
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
