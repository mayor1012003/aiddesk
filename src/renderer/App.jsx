/**
 * App — Root component for AidDesk.
 * 
 * Manages global state: current view, device ID, connection status,
 * active WebRTC peer connection, and data channels.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Dashboard from './components/Dashboard';
import RemoteView from './components/RemoteView';
import ChatPanel from './components/ChatPanel';
import FileManager from './components/FileManager';
import AddressBook from './components/AddressBook';
import SessionLog from './components/SessionLog';
import Settings from './components/Settings';
import ConnectionRequest from './components/ConnectionRequest';
import StatusBar from './components/StatusBar';

// Views
const VIEWS = {
  DASHBOARD: 'dashboard',
  REMOTE: 'remote',
  ADDRESS_BOOK: 'addressBook',
  SESSION_LOG: 'sessionLog',
  SETTINGS: 'settings',
};

export default function App() {
  const [view, setView] = useState(VIEWS.DASHBOARD);
  const [deviceId, setDeviceId] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('disconnected'); // disconnected | connecting | connected
  const [remoteDeviceId, setRemoteDeviceId] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [showFileManager, setShowFileManager] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [connectionRequest, setConnectionRequest] = useState(null);
  const [quality, setQuality] = useState('auto');
  const [sessionStartTime, setSessionStartTime] = useState(null);

  // WebRTC refs
  const peerConnectionRef = useRef(null);
  const dataChannelRef = useRef(null);      // Control channel (input events)
  const chatChannelRef = useRef(null);       // Chat messages
  const fileChannelRef = useRef(null);       // File transfer
  const clipboardChannelRef = useRef(null);  // Clipboard sync
  const signalingWsRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const localStreamRef = useRef(null);
  const inactivityTimerRef = useRef(null);

  // ─── Load Device ID on mount ─────────────────────────────────────────
  useEffect(() => {
    window.aiddesk?.getDeviceId?.().then((id) => {
      setDeviceId(id || 'Unknown');
    }).catch(() => setDeviceId('Unknown'));

    // Listen for incoming connection requests
    window.aiddesk?.onConnectionRequest?.((data) => {
      setConnectionRequest(data);
    });

    return () => {
      disconnect();
    };
  }, []);

  // ─── Signaling Server Connection ────────────────────────────────────

  const connectToSignaling = useCallback(async () => {
    const url = await window.aiddesk?.getSignalingUrl?.();
    if (!url) return null;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        // Register this device on the signaling server
        ws.send(JSON.stringify({ type: 'register', deviceId }));
        console.log('[Signaling] Connected and registered as', deviceId);
        resolve(ws);
      };

      ws.onerror = (err) => {
        console.error('[Signaling] Connection error:', err);
        reject(new Error('Failed to connect to signaling server'));
      };

      ws.onclose = () => {
        console.log('[Signaling] Disconnected');
      };

      ws.onmessage = async (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        await handleSignalingMessage(msg);
      };

      signalingWsRef.current = ws;
    });
  }, [deviceId]);

  // ─── Handle Signaling Messages ──────────────────────────────────────

  const handleSignalingMessage = useCallback(async (msg) => {
    const pc = peerConnectionRef.current;

    switch (msg.type) {
      case 'offer': {
        // Incoming connection: someone wants to view our screen
        console.log('[Signaling] Received offer from', msg.from);

        // Check ACL whitelist
        const isWhitelisted = await window.aiddesk?.isWhitelisted?.(msg.from);
        let approved = isWhitelisted;

        if (!approved) {
          // Show interactive approval dialog
          setConnectionRequest({ requestId: msg.requestId, remoteDeviceId: msg.from });
          // Wait for user response (handled via ConnectionRequest component)
          return;
        }

        await acceptIncomingConnection(msg);
        break;
      }

      case 'answer': {
        // Response to our offer
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          setConnectionStatus('connected');
          setSessionStartTime(Date.now());
          console.log('[WebRTC] Answer received, connection established');
        }
        break;
      }

      case 'ice-candidate': {
        if (pc && msg.candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
          } catch (err) {
            console.error('[WebRTC] Error adding ICE candidate:', err);
          }
        }
        break;
      }

      case 'disconnect': {
        console.log('[Signaling] Remote peer disconnected');
        disconnect();
        break;
      }

      case 'error': {
        console.error('[Signaling] Error:', msg.message);
        setConnectionStatus('disconnected');
        break;
      }
    }
  }, []);

  // ─── Accept an Incoming Connection (Host Side) ──────────────────────

  const acceptIncomingConnection = useCallback(async (msg) => {
    const iceServers = await window.aiddesk?.getIceServers?.() || [];
    const pc = new RTCPeerConnection({ iceServers });
    peerConnectionRef.current = pc;

    // Get screen stream
    const sources = await window.aiddesk?.getScreenSources?.() || [];
    const primaryScreen = sources.find((s) => s.isScreen) || sources[0];
    if (!primaryScreen) {
      console.error('[WebRTC] No screen source available');
      return;
    }

    const constraints = await window.aiddesk?.getCaptureConstraints?.(primaryScreen.id, quality);
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    localStreamRef.current = stream;

    // Add tracks to peer connection
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    // Create data channels for control, chat, files
    setupDataChannels(pc, true);

    // Handle ICE candidates
    pc.onicecandidate = (e) => {
      if (e.candidate && signalingWsRef.current) {
        signalingWsRef.current.send(JSON.stringify({
          type: 'ice-candidate',
          candidate: e.candidate,
          target: msg.from,
          from: deviceId,
        }));
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        disconnect();
      }
    };

    // Set remote description (the offer)
    await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));

    // Create and send answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    signalingWsRef.current?.send(JSON.stringify({
      type: 'answer',
      sdp: answer,
      target: msg.from,
      from: deviceId,
    }));

    setRemoteDeviceId(msg.from);
    setConnectionStatus('connected');
    setSessionStartTime(Date.now());
    setView(VIEWS.REMOTE);

    // Log session
    window.aiddesk?.logSession?.({
      remoteDeviceId: msg.from,
      direction: 'incoming',
      startTime: new Date().toISOString(),
    });

    console.log('[WebRTC] Incoming connection accepted from', msg.from);
  }, [deviceId, quality]);

  // ─── Connect to a Remote Device (Client Side) ───────────────────────

  const connectToDevice = useCallback(async (targetDeviceId) => {
    if (!targetDeviceId || connectionStatus === 'connected') return;

    setConnectionStatus('connecting');
    setRemoteDeviceId(targetDeviceId);

    try {
      // Connect to signaling server
      let ws = signalingWsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        ws = await connectToSignaling();
      }

      // Create peer connection
      const iceServers = await window.aiddesk?.getIceServers?.() || [];
      const pc = new RTCPeerConnection({ iceServers });
      peerConnectionRef.current = pc;

      // Handle incoming stream (the remote screen)
      pc.ontrack = (event) => {
        remoteStreamRef.current = event.streams[0];
        // The RemoteView component will use this stream
        setView(VIEWS.REMOTE);
      };

      // Handle incoming data channels from host
      pc.ondatachannel = (event) => {
        handleIncomingDataChannel(event.channel);
      };

      // Create data channels (client initiates)
      setupDataChannels(pc, false);

      // ICE candidates
      pc.onicecandidate = (e) => {
        if (e.candidate && ws) {
          ws.send(JSON.stringify({
            type: 'ice-candidate',
            candidate: e.candidate,
            target: targetDeviceId,
            from: deviceId,
          }));
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          disconnect();
        }
      };

      // Create offer (we need to add a transceiver to receive video)
      pc.addTransceiver('video', { direction: 'recvonly' });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      ws.send(JSON.stringify({
        type: 'offer',
        sdp: offer,
        target: targetDeviceId,
        from: deviceId,
      }));

      // Log session
      window.aiddesk?.logSession?.({
        remoteDeviceId: targetDeviceId,
        direction: 'outgoing',
        startTime: new Date().toISOString(),
      });

      console.log('[WebRTC] Offer sent to', targetDeviceId);
    } catch (err) {
      console.error('[Connect] Failed:', err);
      setConnectionStatus('disconnected');
    }
  }, [deviceId, connectionStatus, connectToSignaling]);

  // ─── Data Channels Setup ────────────────────────────────────────────

  const setupDataChannels = useCallback((pc, isHost) => {
    if (isHost) {
      // Host creates channels that the client will receive via ondatachannel
      const controlChannel = pc.createDataChannel('control', { ordered: true });
      const chatCh = pc.createDataChannel('chat', { ordered: true });
      const fileCh = pc.createDataChannel('file', { ordered: false, maxRetransmits: 3 });
      const clipCh = pc.createDataChannel('clipboard', { ordered: true });

      controlChannel.onmessage = (e) => handleControlMessage(JSON.parse(e.data));
      chatCh.onmessage = (e) => handleChatMessage(JSON.parse(e.data));

      dataChannelRef.current = controlChannel;
      chatChannelRef.current = chatCh;
      fileChannelRef.current = fileCh;
      clipboardChannelRef.current = clipCh;
    }
    // Client side: channels arrive via pc.ondatachannel (handled in connectToDevice)
  }, []);

  const handleIncomingDataChannel = useCallback((channel) => {
    switch (channel.label) {
      case 'control':
        dataChannelRef.current = channel;
        channel.onmessage = (e) => handleControlMessage(JSON.parse(e.data));
        break;
      case 'chat':
        chatChannelRef.current = channel;
        channel.onmessage = (e) => handleChatMessage(JSON.parse(e.data));
        break;
      case 'file':
        fileChannelRef.current = channel;
        break;
      case 'clipboard':
        clipboardChannelRef.current = channel;
        channel.onmessage = (e) => handleClipboardMessage(JSON.parse(e.data));
        break;
    }
  }, []);

  // ─── Message Handlers ──────────────────────────────────────────────

  const handleControlMessage = useCallback((msg) => {
    // Forward input events to main process for injection
    window.aiddesk?.handleInputEvent?.(msg);
    resetInactivityTimer();
  }, []);

  const handleChatMessage = useCallback((msg) => {
    setChatMessages((prev) => [...prev, { ...msg, incoming: true, timestamp: Date.now() }]);
  }, []);

  const handleClipboardMessage = useCallback((msg) => {
    if (msg.text) {
      window.aiddesk?.setClipboard?.(msg.text);
    }
  }, []);

  // Send chat message
  const sendChatMessage = useCallback((text) => {
    if (!chatChannelRef.current || chatChannelRef.current.readyState !== 'open') return;
    const msg = { text, sender: deviceId, timestamp: Date.now() };
    chatChannelRef.current.send(JSON.stringify(msg));
    setChatMessages((prev) => [...prev, { ...msg, incoming: false }]);
  }, [deviceId]);

  // Send input event to remote
  const sendInputEvent = useCallback((event) => {
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== 'open') return;
    dataChannelRef.current.send(JSON.stringify(event));
    resetInactivityTimer();
  }, []);

  // ─── Inactivity Timer ──────────────────────────────────────────────

  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    const timeout = parseInt(process.env?.INACTIVITY_TIMEOUT || '10', 10);
    if (timeout > 0) {
      inactivityTimerRef.current = setTimeout(() => {
        console.log('[Session] Auto-disconnect due to inactivity');
        disconnect();
      }, timeout * 60 * 1000);
    }
  }, []);

  // ─── Disconnect ─────────────────────────────────────────────────────

  const disconnect = useCallback(() => {
    // Notify remote peer
    if (signalingWsRef.current && signalingWsRef.current.readyState === WebSocket.OPEN) {
      signalingWsRef.current.send(JSON.stringify({
        type: 'disconnect',
        target: remoteDeviceId,
        from: deviceId,
      }));
    }

    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Close data channels
    [dataChannelRef, chatChannelRef, fileChannelRef, clipboardChannelRef].forEach((ref) => {
      if (ref.current) {
        ref.current.close();
        ref.current = null;
      }
    });

    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }

    remoteStreamRef.current = null;

    // Clear timers
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }

    setConnectionStatus('disconnected');
    setView(VIEWS.DASHBOARD);
    setShowChat(false);
    setShowFileManager(false);
    setChatMessages([]);
    setSessionStartTime(null);

    console.log('[Session] Disconnected');
  }, [remoteDeviceId, deviceId]);

  // ─── Connection Request Handler ─────────────────────────────────────

  const handleConnectionResponse = useCallback(async (requestId, accepted) => {
    await window.aiddesk?.respondToConnection?.(requestId, accepted);
    setConnectionRequest(null);
  }, []);

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <div className="app-root">
      {/* Navigation Header */}
      <header className="app-header">
        <div className="header-brand">
          <span className="brand-icon">⚡</span>
          <span className="brand-name">AidDesk</span>
        </div>
        <nav className="header-nav">
          <button
            className={`nav-btn ${view === VIEWS.DASHBOARD ? 'active' : ''}`}
            onClick={() => setView(VIEWS.DASHBOARD)}
          >
            🏠 Dashboard
          </button>
          <button
            className={`nav-btn ${view === VIEWS.ADDRESS_BOOK ? 'active' : ''}`}
            onClick={() => setView(VIEWS.ADDRESS_BOOK)}
          >
            📖 Address Book
          </button>
          <button
            className={`nav-btn ${view === VIEWS.SESSION_LOG ? 'active' : ''}`}
            onClick={() => setView(VIEWS.SESSION_LOG)}
          >
            📜 Session Log
          </button>
          <button
            className={`nav-btn ${view === VIEWS.SETTINGS ? 'active' : ''}`}
            onClick={() => setView(VIEWS.SETTINGS)}
          >
            ⚙️ Settings
          </button>
        </nav>
        <StatusBar
          connectionStatus={connectionStatus}
          remoteDeviceId={remoteDeviceId}
          sessionStartTime={sessionStartTime}
        />
      </header>

      {/* Main Content */}
      <main className="app-main">
        {view === VIEWS.DASHBOARD && (
          <Dashboard
            deviceId={deviceId}
            connectionStatus={connectionStatus}
            onConnect={connectToDevice}
            onDisconnect={disconnect}
          />
        )}

        {view === VIEWS.REMOTE && (
          <div className="remote-container">
            <RemoteView
              remoteStream={remoteStreamRef.current}
              onInputEvent={sendInputEvent}
              quality={quality}
              onQualityChange={setQuality}
              onDisconnect={disconnect}
              onToggleChat={() => setShowChat(!showChat)}
              onToggleFiles={() => setShowFileManager(!showFileManager)}
              remoteDeviceId={remoteDeviceId}
            />
            {showChat && (
              <ChatPanel
                messages={chatMessages}
                onSendMessage={sendChatMessage}
                onClose={() => setShowChat(false)}
              />
            )}
            {showFileManager && (
              <FileManager
                fileChannel={fileChannelRef.current}
                onClose={() => setShowFileManager(false)}
              />
            )}
          </div>
        )}

        {view === VIEWS.ADDRESS_BOOK && (
          <AddressBook onConnect={connectToDevice} />
        )}

        {view === VIEWS.SESSION_LOG && <SessionLog />}

        {view === VIEWS.SETTINGS && <Settings deviceId={deviceId} />}
      </main>

      {/* Connection Request Modal */}
      {connectionRequest && (
        <ConnectionRequest
          request={connectionRequest}
          onRespond={handleConnectionResponse}
        />
      )}
    </div>
  );
}
