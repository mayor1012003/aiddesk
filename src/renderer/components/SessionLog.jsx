/**
 * SessionLog — Local session history viewer.
 * 
 * Displays all past sessions with details like direction,
 * remote device ID, duration, and disconnection reason.
 */

import React, { useState, useEffect } from 'react';

export default function SessionLog() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await window.aiddesk?.getSessions?.(100);
        setSessions(data ?? []);
      } catch (err) {
        console.error('Failed to load sessions:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const formatDuration = (seconds) => {
    if (!seconds || seconds === 0) return '< 1 min';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
  };

  const directionLabel = (dir) => {
    if (dir === 'incoming') return '⬇️ Incoming';
    if (dir === 'outgoing') return '⬆️ Outgoing';
    return dir ?? 'Unknown';
  };

  return (
    <div className="page-container">
      <h2 className="page-title">📜 Session History</h2>
      <p className="page-subtitle">Record of all remote connections</p>

      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : (sessions ?? []).length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📜</div>
          <div>No session history yet</div>
          <div style={{ fontSize: 13, marginTop: 8 }}>Sessions will appear here after your first connection</div>
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
              <th style={thStyle}>Direction</th>
              <th style={thStyle}>Remote Device</th>
              <th style={thStyle}>Start Time</th>
              <th style={thStyle}>Duration</th>
              <th style={thStyle}>Reason</th>
            </tr>
          </thead>
          <tbody>
            {(sessions ?? []).map((s) => (
              <tr key={s?.session_id ?? s?.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={tdStyle}>{directionLabel(s?.direction)}</td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', color: 'var(--accent)' }}>
                  {s?.remote_device_id ?? '---'}
                </td>
                <td style={tdStyle}>
                  {s?.start_time ? new Date(s.start_time).toLocaleString() : '---'}
                </td>
                <td style={tdStyle}>{formatDuration(s?.duration_seconds)}</td>
                <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>
                  {s?.disconnect_reason ?? '---'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const thStyle = {
  padding: '10px 12px',
  fontSize: 12,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  fontWeight: 500,
};

const tdStyle = {
  padding: '10px 12px',
  fontSize: 13,
};
