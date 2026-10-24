/**
 * Settings — Security, 2FA, ACL, and preferences.
 * 
 * Manages:
 * - Unattended access password
 * - TOTP 2FA setup/verification
 * - ACL whitelist management
 * - Permission toggles
 */

import React, { useState, useEffect, useCallback } from 'react';

export default function Settings({ deviceId }) {
  // Password state
  const [hasPassword, setHasPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState('');

  // 2FA state
  const [is2FAEnabled, setIs2FAEnabled] = useState(false);
  const [setupData, setSetupData] = useState(null);
  const [totpToken, setTotpToken] = useState('');
  const [twoFAMsg, setTwoFAMsg] = useState('');

  // ACL state
  const [whitelist, setWhitelist] = useState([]);
  const [newAclId, setNewAclId] = useState('');
  const [newAclNotes, setNewAclNotes] = useState('');

  // Permission toggles
  const [inputEnabled, setInputEnabled] = useState(true);

  // Load initial state
  useEffect(() => {
    (async () => {
      setHasPassword(await window.aiddesk?.hasPassword?.() ?? false);
      setIs2FAEnabled(await window.aiddesk?.is2FAEnabled?.() ?? false);
      setWhitelist(await window.aiddesk?.getWhitelist?.() ?? []);
      setInputEnabled(await window.aiddesk?.getInputEnabled?.() ?? true);
    })();
  }, []);

  // ─── Password ───────────────────────────────────────────────────────

  const handleSetPassword = async () => {
    try {
      await window.aiddesk?.setPassword?.(newPassword);
      setHasPassword(true);
      setNewPassword('');
      setPasswordMsg('Password set successfully');
      setTimeout(() => setPasswordMsg(''), 3000);
    } catch (err) {
      setPasswordMsg(err?.message ?? 'Failed to set password');
    }
  };

  const handleRemovePassword = async () => {
    await window.aiddesk?.removePassword?.();
    setHasPassword(false);
    setPasswordMsg('Password removed');
    setTimeout(() => setPasswordMsg(''), 3000);
  };

  // ─── 2FA ────────────────────────────────────────────────────────────

  const handleSetup2FA = async () => {
    try {
      const data = await window.aiddesk?.setup2FA?.();
      setSetupData(data);
      setTwoFAMsg('');
    } catch (err) {
      setTwoFAMsg(err?.message ?? 'Failed to set up 2FA');
    }
  };

  const handleVerify2FA = async () => {
    const result = await window.aiddesk?.verify2FASetup?.(totpToken);
    if (result) {
      setIs2FAEnabled(true);
      setSetupData(null);
      setTotpToken('');
      setTwoFAMsg('2FA enabled successfully');
    } else {
      setTwoFAMsg('Invalid token. Please try again.');
    }
    setTimeout(() => setTwoFAMsg(''), 3000);
  };

  const handleDisable2FA = async () => {
    await window.aiddesk?.disable2FA?.();
    setIs2FAEnabled(false);
    setTwoFAMsg('2FA disabled');
    setTimeout(() => setTwoFAMsg(''), 3000);
  };

  // ─── ACL ────────────────────────────────────────────────────────────

  const handleAddToWhitelist = async () => {
    const cleaned = newAclId.replace(/\D/g, '');
    if (cleaned.length !== 9) return;
    const formatted = `${cleaned.slice(0,3)}-${cleaned.slice(3,6)}-${cleaned.slice(6,9)}`;
    await window.aiddesk?.addToWhitelist?.(formatted, newAclNotes);
    setNewAclId('');
    setNewAclNotes('');
    setWhitelist(await window.aiddesk?.getWhitelist?.() ?? []);
  };

  const handleRemoveFromWhitelist = async (did) => {
    await window.aiddesk?.removeFromWhitelist?.(did);
    setWhitelist(await window.aiddesk?.getWhitelist?.() ?? []);
  };

  // ─── Input toggle ───────────────────────────────────────────────────

  const handleToggleInput = async (e) => {
    const val = e.target.checked;
    await window.aiddesk?.setInputEnabled?.(val);
    setInputEnabled(val);
  };

  const formatInput = (value) => {
    const digits = value.replace(/\D/g, '').slice(0, 9);
    const parts = [];
    for (let i = 0; i < digits.length; i += 3) {
      parts.push(digits.slice(i, i + 3));
    }
    return parts.join('-');
  };

  return (
    <div className="page-container">
      <h2 className="page-title">⚙️ Settings</h2>
      <p className="page-subtitle">Security and connection preferences</p>

      {/* Device Info */}
      <div className="settings-section">
        <h3 className="settings-title">Device Information</h3>
        <div className="settings-row">
          <div>
            <div className="settings-label">Device ID</div>
            <div className="settings-desc">Your unique identifier for connections</div>
          </div>
          <span style={{ fontFamily: 'monospace', color: 'var(--accent)', fontSize: 16 }}>
            {deviceId ?? '---'}
          </span>
        </div>
      </div>

      {/* Password */}
      <div className="settings-section">
        <h3 className="settings-title">🔐 Unattended Access Password</h3>
        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
          <div className="settings-desc">
            Set a password for unattended access. Remote users will need this password to connect when you're not present.
            {hasPassword && <span style={{ color: 'var(--success)', marginLeft: 8 }}>✓ Password is set</span>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="input"
              type="password"
              placeholder="New password (min 6 characters)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={{ width: 260 }}
            />
            <button className="btn btn-primary btn-sm" onClick={handleSetPassword}
              disabled={newPassword.length < 6}
            >
              {hasPassword ? 'Update' : 'Set'} Password
            </button>
            {hasPassword && (
              <button className="btn btn-danger btn-sm" onClick={handleRemovePassword}>
                Remove
              </button>
            )}
          </div>
          {passwordMsg && (
            <div style={{ fontSize: 13, color: passwordMsg.includes('success') ? 'var(--success)' : 'var(--danger)' }}>
              {passwordMsg}
            </div>
          )}
        </div>
      </div>

      {/* 2FA */}
      <div className="settings-section">
        <h3 className="settings-title">🔐 Two-Factor Authentication (TOTP)</h3>
        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
          <div className="settings-desc">
            Add an extra layer of security with Google Authenticator or any TOTP app.
            {is2FAEnabled && <span style={{ color: 'var(--success)', marginLeft: 8 }}>✓ 2FA is enabled</span>}
          </div>

          {!is2FAEnabled && !setupData && (
            <button className="btn btn-primary btn-sm" onClick={handleSetup2FA}>
              Set Up 2FA
            </button>
          )}

          {setupData && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="settings-desc">Scan this QR code with your authenticator app:</div>
              {setupData.qrDataUrl && (
                <div className="qr-container">
                  <img src={setupData.qrDataUrl} alt="2FA QR Code" />
                </div>
              )}
              <div className="settings-desc">
                Manual key: <code style={{ color: 'var(--accent)' }}>{setupData.secret}</code>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input"
                  type="text"
                  placeholder="Enter 6-digit code"
                  value={totpToken}
                  onChange={(e) => setTotpToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  style={{ width: 160 }}
                  maxLength={6}
                />
                <button className="btn btn-success btn-sm" onClick={handleVerify2FA}
                  disabled={totpToken.length !== 6}
                >
                  Verify & Enable
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => setSetupData(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {is2FAEnabled && (
            <button className="btn btn-danger btn-sm" onClick={handleDisable2FA}>
              Disable 2FA
            </button>
          )}

          {twoFAMsg && (
            <div style={{ fontSize: 13, color: twoFAMsg.includes('success') || twoFAMsg.includes('enabled') ? 'var(--success)' : 'var(--danger)' }}>
              {twoFAMsg}
            </div>
          )}
        </div>
      </div>

      {/* ACL Whitelist */}
      <div className="settings-section">
        <h3 className="settings-title">🛡️ ACL Whitelist</h3>
        <div className="settings-desc" style={{ marginBottom: 12 }}>
          Devices on this list can connect without interactive approval (password/2FA still required if set).
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            className="input"
            placeholder="Device ID (XXX-XXX-XXX)"
            value={newAclId}
            onChange={(e) => setNewAclId(formatInput(e.target.value))}
            maxLength={11}
            style={{ width: 180 }}
          />
          <input
            className="input"
            placeholder="Notes (optional)"
            value={newAclNotes}
            onChange={(e) => setNewAclNotes(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="btn btn-primary btn-sm" onClick={handleAddToWhitelist}>
            Add
          </button>
        </div>

        {(whitelist ?? []).length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No devices whitelisted</div>
        ) : (
          (whitelist ?? []).map((item) => (
            <div key={item?.id ?? item?.device_id} className="card" style={{ padding: 12, marginBottom: 8 }}>
              <div className="card-row">
                <div>
                  <span style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>
                    {item?.device_id ?? '---'}
                  </span>
                  {item?.notes && (
                    <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                      {item.notes}
                    </span>
                  )}
                </div>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => handleRemoveFromWhitelist(item?.device_id)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Permissions */}
      <div className="settings-section">
        <h3 className="settings-title">🎛️ Permissions</h3>
        <div className="settings-row">
          <div>
            <div className="settings-label">Allow Remote Input</div>
            <div className="settings-desc">Enable mouse and keyboard control from remote users</div>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={inputEnabled} onChange={handleToggleInput} />
            <span className="toggle-slider" />
          </label>
        </div>
      </div>
    </div>
  );
}
