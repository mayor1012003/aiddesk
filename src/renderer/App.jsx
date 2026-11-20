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
import { getSignalingClient, SignalingStatus } from './signalingClient';

// Views
const VIEWS = {
  DASHBOARD: 'dashboard',
  REMOTE: 'remote',
  ADDRESS_BOOK: 'addressBook',
  SESSION_LOG: 'sessionLog',
  SETTINGS: 'settings',
};

const DEFAULT_RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

/**
 * RTCPeerConnection config for both caller and callee: STUN + short-lived TURN
 * from the signaling server (fetched in the main process), with STUN fallback.
 */
async function getRtcConfiguration() {
  try {
    const cfg = await window.aiddesk?.getRtcConfig?.();
    if (cfg?.iceServers?.length) {
      console.log(`[WebRTC] ICE config: turnEnabled=${cfg.turnEnabled}, policy=${cfg.iceTransportPolicy}, source=${cfg.source}`);
      return { iceServers: cfg.iceServers, iceTransportPolicy: cfg.iceTransportPolicy || 'all' };
    }
    const iceServers = await window.aiddesk?.getIceServers?.();
    if (iceServers?.length) return { iceServers };
  } catch (err) {
    console.warn('[WebRTC] Failed to load ICE config, using STUN fallback:', err);
  }
  return DEFAULT_RTC_CONFIG;
}

const DEVICE_ID_RE = /^\d{3}-\d{3}-\d{3}$/;
const DISCONNECT_GRACE_MS = 8000; // tolerate brief ICE "disconnected" blips before ending a session

function parseJson(data) {
  try { return JSON.parse(data); } catch { return null; }
}

function inactivityTimeoutMinutes() {
  // `process` doesn't exist in the sandboxed renderer — guard it to avoid a ReferenceError.
  const raw = (typeof process !== 'undefined' && process.env && process.env.INACTIVITY_TIMEOUT) || '10';
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 10;
}

export default function App() {
  const [view, setView] = useState(VIEWS.DASHBOARD);
  const [deviceId, setDeviceId] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('disconnected'); // session: disconnected | connecting | connected
  const [signalingStatus, setSignalingStatus] = useState(SignalingStatus.CONNECTING); // server: offline | connecting | online | replaced
  const [sessionNotice, setSessionNotice] = useState('');
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
  const remoteStreamRef = useRef(null);
  const localStreamRef = useRef(null);
  const inactivityTimerRef = useRef(null);
  const disconnectTimerRef = useRef(null);

  // Signaling / session refs (refs, not state, so async handlers never see stale values)
  const signalingRef = useRef(null);          // shared SignalingClient (one socket per app)
  const deviceIdRef = useRef('');
  const remoteDeviceIdRef = useRef('');       // peer of the current/pending session
  const pendingOfferRef = useRef(null);       // { msg, requestId } awaiting host approval
  const pendingCandidatesRef = useRef([]);    // [{ from, candidate }] received before remoteDescription
  const connectionStatusRef = useRef('disconnected');
  const qualityRef = useRef(quality);
  const signalingHandlerRef = useRef(null);

  deviceIdRef.current = deviceId;
  connectionStatusRef.current = connectionStatus;
  qualityRef.current = quality;

  const updateSessionStatus = (status) => {
    connectionStatusRef.current = status;
    setConnectionStatus(status);
  };

  /** Send over the shared, registered signaling socket. Returns false if offline. */
  const sendSignal = (obj) => Boolean(signalingRef.current?.send({ ...obj, from: deviceIdRef.current }));

  // ─── Load Device ID on mount ─────────────────────────────────────────
  useEffect(() => {
    window.aiddesk?.getDeviceId?.().then((id) => {
      setDeviceId(id || 'Unknown');
    }).catch(() => setDeviceId('Unknown'));

    // Listen for incoming connection requests from the main process
    window.aiddesk?.onConnectionRequest?.((data) => {
      setConnectionRequest(data);
    });

    return () => {
      endSession({ notifyRemote: true });
    };
  }, []);

  // ─── Signaling: connect + register as soon as the Device ID is known ──
  // Every instance (host or caller) stays registered so it can receive offers without
  // clicking anything. The client is an app-wide singleton, so StrictMode double-mounts
  // and re-renders never open a second socket; cleanup only unsubscribes.
  useEffect(() => {
    if (!DEVICE_ID_RE.test(deviceId)) {
      if (deviceId) setSignalingStatus(SignalingStatus.OFFLINE); // 'Unknown' — can't register
      return undefined;
    }
    let cancelled = false;
    const unsubscribers = [];
    (async () => {
      const url = await window.aiddesk?.getSignalingUrl?.();
      if (cancelled) return;
      if (!url) {
        console.error('[Signaling] No signaling server URL configured');
        setSignalingStatus(SignalingStatus.OFFLINE);
        return;
      }
      const client = getSignalingClient({ url, deviceId });
      signalingRef.current = client;
      unsubscribers.push(client.onStatus((status) => {
        setSignalingStatus(status);
        window.aiddesk?.setSignalingStatus?.(status)?.catch?.(() => {}); // tray / menu bar status
      }));
      unsubscribers.push(client.onMessage((msg) => {
        Promise.resolve(signalingHandlerRef.current?.(msg)).catch((err) => {
          console.error('[Signaling] Error handling message:', err);
        });
      }));
      client.start();
    })().catch((err) => {
      console.error('[Signaling] Failed to start:', err);
      setSignalingStatus(SignalingStatus.OFFLINE);
    });
    return () => {
      cancelled = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [deviceId]);

  // ─── ICE candidate queueing ──────────────────────────────────────────

  const addIceCandidate = async (pc, candidate) => {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('[WebRTC] Error adding ICE candidate:', err);
    }
  };

  /** Apply candidates that arrived before setRemoteDescription (e.g. while the approval dialog was open). */
  const flushPendingCandidates = async (pc, remoteId) => {
    const queued = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    for (const item of queued) {
      if (!item.from || item.from === remoteId) await addIceCandidate(pc, item.candidate);
    }
  };

  const watchConnectionState = (pc) => {
    pc.onconnectionstatechange = () => {
      if (peerConnectionRef.current !== pc) return;
      const state = pc.connectionState;
      if (state === 'connected') {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      } else if (state === 'failed' || state === 'closed') {
        console.warn('[WebRTC] Connection', state);
        endSession({ notifyRemote: true });
      } else if (state === 'disconnected' && !disconnectTimerRef.current) {
        disconnectTimerRef.current = setTimeout(() => {
          disconnectTimerRef.current = null;
          if (peerConnectionRef.current === pc && pc.connectionState === 'disconnected') {
            endSession({ notifyRemote: true });
          }
        }, DISCONNECT_GRACE_MS);
      }
    };
  };

  // ─── Handle Signaling Messages ──────────────────────────────────────
  // Re-assigned every render and invoked through signalingHandlerRef, so it always
  // uses the latest functions; all session data lives in refs.

  const handleSignalingMessage = async (msg) => {
    switch (msg.type) {
      case 'offer': {
        // Incoming connection: someone wants to view our screen
        if (!msg.from || !msg.sdp) return;
        console.log('[Signaling] Received offer from', msg.from);

        const busyWithOther =
          peerConnectionRef.current ||
          (pendingOfferRef.current && pendingOfferRef.current.msg.from !== msg.from);
        if (busyWithOther) {
          sendSignal({ type: 'disconnect', target: msg.from, reason: 'busy' });
          return;
        }

        const requestId = msg.requestId || `${msg.from}-${Date.now()}`;
        const pending = { msg, requestId };
        pendingOfferRef.current = pending;
        // Keep only candidates that already arrived from this caller
        pendingCandidatesRef.current = pendingCandidatesRef.current.filter((c) => c.from === msg.from);

        // Unattended access: the caller supplied this device's password (+ 2FA code).
        // Carried top-level (`auth`) and inside the sdp object, so it also works through
        // signaling servers that don't relay `auth` yet.
        const auth = msg.auth || msg.sdp?.auth;
        if (auth?.password) {
          const result = await Promise.resolve(
            window.aiddesk?.verifyUnattended?.(msg.from, auth.password, auth.totp),
          ).catch(() => null);
          if (pendingOfferRef.current !== pending) return; // cancelled meanwhile
          if (result?.ok) {
            console.log('[Auth] Unattended access granted to', msg.from);
            pendingOfferRef.current = null;
            await acceptIncomingConnection(msg);
            return;
          }
          if (result && result.reason !== 'no-password-set') {
            console.warn('[Auth] Unattended access denied for', msg.from, result.reason);
            pendingOfferRef.current = null;
            pendingCandidatesRef.current = [];
            sendSignal({ type: 'disconnect', target: msg.from, reason: result.reason === 'locked' ? 'locked' : 'bad-password' });
            return;
          }
          // No password configured here (or check failed): fall back to asking the user.
        }

        // Check ACL whitelist
        const whitelisted = await Promise.resolve(window.aiddesk?.isWhitelisted?.(msg.from)).catch(() => false);
        if (pendingOfferRef.current !== pending) return; // cancelled meanwhile

        if (whitelisted) {
          pendingOfferRef.current = null;
          await acceptIncomingConnection(msg);
        } else {
          // Show interactive approval dialog; handleConnectionResponse continues from here.
          // If AidDesk is hidden in the tray, bring it forward + native notification.
          setConnectionRequest({ requestId, remoteDeviceId: msg.from });
          window.aiddesk?.notifyIncomingRequest?.(msg.from)?.catch?.(() => {});
        }
        break;
      }

      case 'answer': {
        // Response to our offer
        const pc = peerConnectionRef.current;
        if (!pc || pc.signalingState !== 'have-local-offer') return;
        if (msg.from && msg.from !== remoteDeviceIdRef.current) return;
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        await flushPendingCandidates(pc, msg.from);
        updateSessionStatus('connected');
        setSessionStartTime(Date.now());
        console.log('[WebRTC] Answer received, connection established');
        break;
      }

      case 'ice-candidate': {
        if (!msg.candidate) return;
        const expected = remoteDeviceIdRef.current || pendingOfferRef.current?.msg.from;
        if (msg.from && expected && msg.from !== expected) return;
        const pc = peerConnectionRef.current;
        if (pc && pc.remoteDescription) {
          await addIceCandidate(pc, msg.candidate);
        } else {
          pendingCandidatesRef.current.push({ from: msg.from, candidate: msg.candidate });
        }
        break;
      }

      case 'disconnect': {
        const pending = pendingOfferRef.current;
        if (pending && msg.from === pending.msg.from && !peerConnectionRef.current) {
          // Caller cancelled before we answered
          pendingOfferRef.current = null;
          pendingCandidatesRef.current = [];
          setConnectionRequest(null);
          return;
        }
        const remoteId = remoteDeviceIdRef.current;
        if (!remoteId || (msg.from && msg.from !== remoteId)) return;
        console.log('[Signaling] Remote peer disconnected', msg.reason ? `(${msg.reason})` : '');
        if (msg.reason === 'rejected') setSessionNotice(`${remoteId} declined the connection.`);
        else if (msg.reason === 'busy') setSessionNotice(`${remoteId} is busy in another session.`);
        else if (msg.reason === 'host-error') setSessionNotice(`${remoteId} could not start screen sharing.`);
        else if (msg.reason === 'bad-password') setSessionNotice(`Wrong unattended password or 2FA code for ${remoteId}.`);
        else if (msg.reason === 'locked') setSessionNotice(`Too many failed attempts on ${remoteId} — wait a minute and try again.`);
        endSession({ notifyRemote: false });
        break;
      }

      case 'error': {
        console.error('[Signaling] Error:', msg.message);
        // e.g. "Device X is not online" in reply to our offer
        if (/is not online/i.test(msg.message || '') && connectionStatusRef.current === 'connecting') {
          setSessionNotice(msg.message);
          endSession({ notifyRemote: false });
        }
        break;
      }

      default:
        break;
    }
  };
  signalingHandlerRef.current = handleSignalingMessage;

  // ─── Accept an Incoming Connection (Host Side) ──────────────────────

  const acceptIncomingConnection = async (msg) => {
    const remoteId = msg.from;
    remoteDeviceIdRef.current = remoteId;
    setRemoteDeviceId(remoteId);
    setSessionNotice('');
    updateSessionStatus('connecting');

    let pc;
    try {
      pc = new RTCPeerConnection(await getRtcConfiguration());
      if (remoteDeviceIdRef.current !== remoteId) { pc.close(); return; } // ended meanwhile
      peerConnectionRef.current = pc;

      // The caller creates the data channels; we receive them here.
      pc.ondatachannel = (event) => attachDataChannel(event.channel, true);

      pc.onicecandidate = (e) => {
        if (e.candidate) sendSignal({ type: 'ice-candidate', candidate: e.candidate, target: remoteId });
      };
      watchConnectionState(pc);

      // Apply the offer first so our screen track goes into the caller's offered
      // video transceiver (adding it before would create an un-negotiated m-line).
      await pc.setRemoteDescription(new RTCSessionDescription({ type: msg.sdp.type, sdp: msg.sdp.sdp }));
      await flushPendingCandidates(pc, remoteId);

      // Get screen stream
      const sources = (await window.aiddesk?.getScreenSources?.()) || [];
      const primaryScreen = sources.find((s) => s.isScreen) || sources[0];
      if (!primaryScreen) throw new Error('No screen source available');

      const constraints = await window.aiddesk?.getCaptureConstraints?.(primaryScreen.id, qualityRef.current);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (peerConnectionRef.current !== pc) { stream.getTracks().forEach((t) => t.stop()); return; }
      localStreamRef.current = stream;

      const [videoTrack] = stream.getVideoTracks();
      const transceiver = pc.getTransceivers().find(
        (t) => t.receiver?.track?.kind === 'video' && !t.sender.track && !t.stopped,
      );
      if (transceiver && videoTrack) {
        await transceiver.sender.replaceTrack(videoTrack);
        transceiver.sender.setStreams?.(stream);
        transceiver.direction = 'sendonly';
      } else {
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      }

      // Create and send answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (!sendSignal({ type: 'answer', sdp: answer, target: remoteId })) {
        throw new Error('Lost connection to the signaling server');
      }

      updateSessionStatus('connected');
      setSessionStartTime(Date.now());
      setView(VIEWS.REMOTE);

      // Log session
      window.aiddesk?.logSession?.({
        remoteDeviceId: remoteId,
        direction: 'incoming',
        startTime: new Date().toISOString(),
      });

      console.log('[WebRTC] Incoming connection accepted from', remoteId);
    } catch (err) {
      console.error('[WebRTC] Failed to accept incoming connection:', err);
      sendSignal({ type: 'disconnect', target: remoteId, reason: 'host-error' });
      endSession({ notifyRemote: false });
    }
  };

  // ─── Connect to a Remote Device (Client Side) ───────────────────────

  const connectToDevice = async (rawTargetId, { password, totp } = {}) => {
    const targetDeviceId = (rawTargetId || '').trim();
    if (!targetDeviceId || peerConnectionRef.current || connectionStatusRef.current !== 'disconnected') return;
    if (targetDeviceId === deviceIdRef.current) {
      setSessionNotice('That is this device\'s own ID.');
      return;
    }

    setSessionNotice('');
    updateSessionStatus('connecting');
    setRemoteDeviceId(targetDeviceId);
    remoteDeviceIdRef.current = targetDeviceId;
    pendingCandidatesRef.current = [];

    try {
      // Reuse the app's already-registered socket (waits briefly if it's reconnecting).
      const client = signalingRef.current;
      if (!client) throw new Error('Signaling server not configured yet');
      await client.waitUntilRegistered(15000);

      // Fetched only after registration, so /ice-servers sees this device as online
      // and grants TURN credentials.
      const pc = new RTCPeerConnection(await getRtcConfiguration());
      if (remoteDeviceIdRef.current !== targetDeviceId) { pc.close(); return; } // cancelled meanwhile
      peerConnectionRef.current = pc;

      // Handle incoming stream (the remote screen)
      pc.ontrack = (event) => {
        remoteStreamRef.current = event.streams[0] || new MediaStream([event.track]);
        // The RemoteView component will use this stream
        setView(VIEWS.REMOTE);
      };

      // The caller creates all data channels so they're part of the offer
      // (channels created by the answerer would need renegotiation).
      [
        pc.createDataChannel('control', { ordered: true }),
        pc.createDataChannel('chat', { ordered: true }),
        pc.createDataChannel('file', { ordered: false, maxRetransmits: 3 }),
        pc.createDataChannel('clipboard', { ordered: true }),
      ].forEach((channel) => attachDataChannel(channel, false));

      // ICE candidates
      pc.onicecandidate = (e) => {
        if (e.candidate) sendSignal({ type: 'ice-candidate', candidate: e.candidate, target: targetDeviceId });
      };
      watchConnectionState(pc);

      // Receive the host's screen
      pc.addTransceiver('video', { direction: 'recvonly' });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const requestId = `${deviceIdRef.current}-${Date.now()}`;
      const auth = password ? { password, totp: totp || undefined } : undefined;
      const sdp = { type: offer.type, sdp: offer.sdp, ...(auth ? { auth } : {}) };
      if (!sendSignal({ type: 'offer', sdp, target: targetDeviceId, requestId, auth })) {
        throw new Error('Lost connection to the signaling server');
      }

      // Log session
      window.aiddesk?.logSession?.({
        remoteDeviceId: targetDeviceId,
        direction: 'outgoing',
        startTime: new Date().toISOString(),
      });

      console.log('[WebRTC] Offer sent to', targetDeviceId);
    } catch (err) {
      console.error('[Connect] Failed:', err);
      setSessionNotice(err?.message || 'Connection failed');
      endSession({ notifyRemote: false });
    }
  };

  // ─── Data Channels ──────────────────────────────────────────────────

  const attachDataChannel = (channel, isHost) => {
    switch (channel.label) {
      case 'control':
        dataChannelRef.current = channel;
        // Only the host injects input received on the control channel.
        if (isHost) {
          channel.onmessage = (e) => {
            const msg = parseJson(e.data);
            if (msg) handleControlMessage(msg);
          };
        }
        break;
      case 'chat':
        chatChannelRef.current = channel;
        channel.onmessage = (e) => {
          const msg = parseJson(e.data);
          if (msg) handleChatMessage(msg);
        };
        break;
      case 'file':
        fileChannelRef.current = channel;
        break;
      case 'clipboard':
        clipboardChannelRef.current = channel;
        channel.onmessage = (e) => {
          const msg = parseJson(e.data);
          if (msg) handleClipboardMessage(msg);
        };
        break;
      default:
        break;
    }
  };

  // ─── Message Handlers ──────────────────────────────────────────────

  const handleControlMessage = (msg) => {
    // Forward input events to main process for injection
    window.aiddesk?.handleInputEvent?.(msg);
    resetInactivityTimer();
  };

  const handleChatMessage = (msg) => {
    setChatMessages((prev) => [...prev, { ...msg, incoming: true, timestamp: Date.now() }]);
  };

  const handleClipboardMessage = (msg) => {
    if (msg.text) {
      window.aiddesk?.setClipboard?.(msg.text);
    }
  };

  // Send chat message
  const sendChatMessage = useCallback((text) => {
    if (!chatChannelRef.current || chatChannelRef.current.readyState !== 'open') return;
    const msg = { text, sender: deviceIdRef.current, timestamp: Date.now() };
    chatChannelRef.current.send(JSON.stringify(msg));
    setChatMessages((prev) => [...prev, { ...msg, incoming: false }]);
  }, []);

  // Send input event to remote
  const sendInputEvent = useCallback((event) => {
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== 'open') return;
    dataChannelRef.current.send(JSON.stringify(event));
    resetInactivityTimer();
  }, []);

  // ─── Inactivity Timer ──────────────────────────────────────────────

  const resetInactivityTimer = () => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    const timeout = inactivityTimeoutMinutes();
    if (timeout > 0) {
      inactivityTimerRef.current = setTimeout(() => {
        console.log('[Session] Auto-disconnect due to inactivity');
        endSession({ notifyRemote: true });
      }, timeout * 60 * 1000);
    }
  };

  // ─── Disconnect ─────────────────────────────────────────────────────

  /** Tear down the current session. Uses only refs/setters, so any render's copy is safe to call. */
  function endSession({ notifyRemote = true } = {}) {
    const remoteId = remoteDeviceIdRef.current;
    if (notifyRemote && remoteId) {
      sendSignal({ type: 'disconnect', target: remoteId });
    }
    remoteDeviceIdRef.current = '';
    pendingOfferRef.current = null;
    pendingCandidatesRef.current = [];

    // Close peer connection
    const pc = peerConnectionRef.current;
    peerConnectionRef.current = null;
    if (pc) {
      pc.onconnectionstatechange = null;
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.ondatachannel = null;
      pc.close();
    }

    // Close data channels
    [dataChannelRef, chatChannelRef, fileChannelRef, clipboardChannelRef].forEach((ref) => {
      if (ref.current) {
        try { ref.current.close(); } catch { /* ignore */ }
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
    [inactivityTimerRef, disconnectTimerRef].forEach((ref) => {
      if (ref.current) {
        clearTimeout(ref.current);
        ref.current = null;
      }
    });

    updateSessionStatus('disconnected');
    setView((current) => (current === VIEWS.REMOTE ? VIEWS.DASHBOARD : current));
    setShowChat(false);
    setShowFileManager(false);
    setChatMessages([]);
    setSessionStartTime(null);

    console.log('[Session] Disconnected');
  }

  const disconnect = useCallback(() => endSession({ notifyRemote: true }), []);

  // ─── Connection Request Handler ─────────────────────────────────────
  // Stable identity (ConnectionRequest's countdown effect depends on it) and
  // idempotent (the auto-deny may fire more than once under StrictMode).

  const connectionResponseRef = useRef(null);
  connectionResponseRef.current = async (requestId, accepted) => {
    setConnectionRequest(null);
    Promise.resolve(window.aiddesk?.respondToConnection?.(requestId, accepted)).catch(() => {});

    const pending = pendingOfferRef.current;
    if (!pending || pending.requestId !== requestId) return;
    pendingOfferRef.current = null;

    if (accepted) {
      await acceptIncomingConnection(pending.msg);
    } else {
      // Tell the caller right away instead of leaving them on "Connecting…"
      sendSignal({ type: 'disconnect', target: pending.msg.from, reason: 'rejected' });
      pendingCandidatesRef.current = [];
    }
  };
  const handleConnectionResponse = useCallback(
    (requestId, accepted) => connectionResponseRef.current(requestId, accepted),
    [],
  );

  const connectToDeviceRef = useRef(null);
  connectToDeviceRef.current = connectToDevice;
  const handleConnect = useCallback((targetId, options) => connectToDeviceRef.current(targetId, options), []);

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
          signalingStatus={signalingStatus}
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
            signalingStatus={signalingStatus}
            notice={sessionNotice}
            onConnect={handleConnect}
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
          <AddressBook onConnect={handleConnect} />
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
