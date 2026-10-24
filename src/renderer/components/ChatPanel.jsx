/**
 * ChatPanel — Text chat sidebar during remote sessions.
 * 
 * Sends/receives messages over a dedicated WebRTC DataChannel.
 */

import React, { useState, useRef, useEffect } from 'react';

export default function ChatPanel({ messages = [], onSendMessage, onClose }) {
  const [text, setText] = useState('');
  const messagesEndRef = useRef(null);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages?.length]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSendMessage?.(trimmed);
    setText('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <h3>💬 Chat</h3>
        <button className="btn-icon" onClick={onClose}>✕</button>
      </div>

      <div className="chat-messages">
        {(messages ?? []).length === 0 && (
          <div className="empty-state" style={{ padding: 20, fontSize: 13 }}>
            No messages yet. Start typing below.
          </div>
        )}
        {(messages ?? []).map((msg, i) => (
          <div key={i} className={`chat-message ${msg?.incoming ? 'incoming' : 'outgoing'}`}>
            <div>{msg?.text ?? ''}</div>
            <div style={{ fontSize: 10, marginTop: 4, opacity: 0.6 }}>
              {formatTime(msg?.timestamp)}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-row">
        <input
          className="chat-input"
          type="text"
          placeholder="Type a message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button className="btn btn-primary btn-sm" onClick={handleSend}>
          Send
        </button>
      </div>
    </div>
  );
}
