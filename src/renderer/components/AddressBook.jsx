/**
 * AddressBook — Saved remote devices list.
 * 
 * Users can save Device IDs with aliases, view connection history,
 * and quickly connect to saved devices.
 */

import React, { useState, useEffect, useCallback } from 'react';

export default function AddressBook({ onConnect }) {
  const [entries, setEntries] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newDeviceId, setNewDeviceId] = useState('');
  const [newAlias, setNewAlias] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [editId, setEditId] = useState(null);

  const loadEntries = useCallback(async () => {
    const data = await window.aiddesk?.getAddressBook?.();
    setEntries(data ?? []);
  }, []);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const handleAdd = async () => {
    const cleaned = newDeviceId.replace(/\D/g, '');
    if (cleaned.length !== 9 || !newAlias.trim()) return;

    const formatted = `${cleaned.slice(0,3)}-${cleaned.slice(3,6)}-${cleaned.slice(6,9)}`;
    await window.aiddesk?.addToAddressBook?.(formatted, newAlias.trim(), newNotes.trim());
    setNewDeviceId('');
    setNewAlias('');
    setNewNotes('');
    setShowAdd(false);
    loadEntries();
  };

  const handleDelete = async (deviceId) => {
    await window.aiddesk?.removeFromAddressBook?.(deviceId);
    loadEntries();
  };

  const handleUpdate = async (deviceId) => {
    const entry = entries.find((e) => e?.device_id === deviceId);
    if (!entry) return;
    await window.aiddesk?.updateAddressBookEntry?.(deviceId, entry.alias, entry.notes);
    setEditId(null);
    loadEntries();
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 className="page-title">📖 Address Book</h2>
          <p className="page-subtitle">Saved devices for quick access</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(!showAdd)}>
          + Add Device
        </button>
      </div>

      {/* Add New Form */}
      {showAdd && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <input
              className="input"
              placeholder="Device ID (XXX-XXX-XXX)"
              value={newDeviceId}
              onChange={(e) => setNewDeviceId(formatInput(e.target.value))}
              maxLength={11}
              style={{ width: 180 }}
            />
            <input
              className="input"
              placeholder="Alias (e.g. John's PC)"
              value={newAlias}
              onChange={(e) => setNewAlias(e.target.value)}
              style={{ flex: 1, minWidth: 150 }}
            />
            <input
              className="input"
              placeholder="Notes (optional)"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              style={{ flex: 1, minWidth: 150 }}
            />
            <button className="btn btn-success btn-sm" onClick={handleAdd}>Save</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Entries List */}
      {(entries ?? []).length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📖</div>
          <div>No saved devices yet</div>
          <div style={{ fontSize: 13, marginTop: 8 }}>Click "Add Device" to save a remote device</div>
        </div>
      ) : (
        (entries ?? []).map((entry) => (
          <div key={entry?.id ?? entry?.device_id} className="card">
            <div className="card-row">
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{entry?.alias || 'Unnamed'}</div>
                <div style={{
                  fontFamily: 'monospace', fontSize: 14,
                  color: 'var(--accent)', marginTop: 4,
                }}>
                  {entry?.device_id ?? '---'}
                </div>
                {entry?.notes && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    {entry.notes}
                  </div>
                )}
                {entry?.last_connected && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    Last connected: {new Date(entry.last_connected).toLocaleString()}
                  </div>
                )}
              </div>
              <div className="card-actions">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => onConnect?.(entry?.device_id)}
                >
                  → Connect
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleDelete(entry?.device_id)}
                  title="Delete"
                >
                  🗑
                </button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
