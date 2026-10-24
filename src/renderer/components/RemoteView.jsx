/**
 * RemoteView — Live remote screen display with input capture.
 * 
 * Renders the incoming WebRTC video stream and captures all
 * mouse/keyboard events to forward to the remote host.
 * Includes a toolbar for quality, chat, files, recording, and disconnect.
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';

export default function RemoteView({
  remoteStream,
  onInputEvent,
  quality,
  onQualityChange,
  onDisconnect,
  onToggleChat,
  onToggleFiles,
  remoteDeviceId,
}) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const mediaRecorderRef = useRef(null);

  // Attach the remote stream to the video element
  useEffect(() => {
    if (videoRef.current && remoteStream) {
      videoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // ─── Input Event Handlers ──────────────────────────────────────────

  /**
   * Normalize mouse coordinates to 0-1 range relative to the video.
   */
  const getNormalizedCoords = useCallback((e) => {
    const video = videoRef.current;
    if (!video) return { x: 0, y: 0 };

    const rect = video.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return { x, y };
  }, []);

  const mapButton = (button) => {
    switch (button) {
      case 2: return 'right';
      case 1: return 'middle';
      default: return 'left';
    }
  };

  const getModifiers = (e) => ({
    ctrl: e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    meta: e.metaKey,
  });

  const handleMouseMove = useCallback((e) => {
    const coords = getNormalizedCoords(e);
    onInputEvent?.({ type: 'mousemove', ...coords });
  }, [getNormalizedCoords, onInputEvent]);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    const coords = getNormalizedCoords(e);
    onInputEvent?.({ type: 'mousedown', ...coords, button: mapButton(e.button) });
  }, [getNormalizedCoords, onInputEvent]);

  const handleMouseUp = useCallback((e) => {
    const coords = getNormalizedCoords(e);
    onInputEvent?.({ type: 'mouseup', ...coords, button: mapButton(e.button) });
  }, [getNormalizedCoords, onInputEvent]);

  const handleDblClick = useCallback((e) => {
    e.preventDefault();
    const coords = getNormalizedCoords(e);
    onInputEvent?.({ type: 'dblclick', ...coords, button: 'left' });
  }, [getNormalizedCoords, onInputEvent]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const coords = getNormalizedCoords(e);
    onInputEvent?.({
      type: 'scroll',
      ...coords,
      deltaX: Math.sign(e.deltaX) * 3,
      deltaY: Math.sign(e.deltaY) * 3,
    });
  }, [getNormalizedCoords, onInputEvent]);

  const handleContextMenu = useCallback((e) => {
    e.preventDefault(); // Prevent browser context menu
  }, []);

  const handleKeyDown = useCallback((e) => {
    e.preventDefault();
    onInputEvent?.({
      type: 'keydown',
      key: e.key,
      code: e.code,
      modifiers: getModifiers(e),
    });
  }, [onInputEvent]);

  const handleKeyUp = useCallback((e) => {
    e.preventDefault();
    onInputEvent?.({
      type: 'keyup',
      key: e.key,
      code: e.code,
      modifiers: getModifiers(e),
    });
  }, [onInputEvent]);

  // ─── Recording ─────────────────────────────────────────────────────

  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      // Stop recording
      mediaRecorderRef.current?.stop?.();
      await window.aiddesk?.stopRecording?.();
      setIsRecording(false);
    } else {
      // Start recording
      if (!remoteStream) return;
      await window.aiddesk?.startRecording?.(remoteDeviceId || 'unknown');

      const recorder = new MediaRecorder(remoteStream, {
        mimeType: 'video/webm;codecs=vp9',
      });

      recorder.ondataavailable = async (e) => {
        if (e.data.size > 0) {
          const buffer = await e.data.arrayBuffer();
          await window.aiddesk?.writeRecordingChunk?.(buffer);
        }
      };

      recorder.start(1000); // Chunk every second
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    }
  }, [isRecording, remoteStream, remoteDeviceId]);

  // ─── Fullscreen ────────────────────────────────────────────────────

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  }, []);

  return (
    <div className="remote-view" ref={containerRef} tabIndex={0}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
    >
      {/* Remote Screen */}
      <div className="remote-video-container">
        <video
          ref={videoRef}
          className="remote-video"
          autoPlay
          playsInline
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onDoubleClick={handleDblClick}
          onWheel={handleWheel}
          onContextMenu={handleContextMenu}
        />

        {/* Recording indicator */}
        {isRecording && (
          <div style={{
            position: 'absolute', top: 12, right: 12,
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'rgba(248,113,113,0.9)', padding: '4px 10px',
            borderRadius: 6, fontSize: 12, color: '#fff',
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff', animation: 'pulse 1s infinite' }} />
            Recording
          </div>
        )}

        {/* No stream placeholder */}
        {!remoteStream && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', fontSize: 16,
          }}>
            Waiting for remote screen…
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="remote-toolbar">
        <button className="btn-icon" title="Disconnect" onClick={onDisconnect}>
          ⏻
        </button>
        <div className="toolbar-separator" />

        <select
          className="quality-select"
          value={quality}
          onChange={(e) => onQualityChange?.(e.target.value)}
          title="Quality"
        >
          <option value="auto">Auto</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        <div className="toolbar-separator" />

        <button className="btn-icon" title="Toggle Chat" onClick={onToggleChat}>
          💬
        </button>
        <button className="btn-icon" title="File Transfer" onClick={onToggleFiles}>
          📁
        </button>
        <button
          className="btn-icon"
          title={isRecording ? 'Stop Recording' : 'Start Recording'}
          onClick={toggleRecording}
          style={isRecording ? { color: 'var(--danger)' } : {}}
        >
          {isRecording ? '⏹' : '⏺'}
        </button>
        <button className="btn-icon" title="Fullscreen" onClick={toggleFullscreen}>
          {isFullscreen ? '⬜' : '⛶'}
        </button>
      </div>
    </div>
  );
}
