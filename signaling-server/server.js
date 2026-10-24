/**
 * AidDesk Signaling Server
 * 
 * A lightweight WebSocket server that relays WebRTC signaling messages
 * (SDP offers/answers and ICE candidates) between AidDesk peers.
 * 
 * The server NEVER sees media content — it only routes signaling.
 * Peers go fully P2P (direct WebRTC) after the handshake.
 * 
 * Usage:
 *   node server.js
 *   PORT=9090 node server.js
 *   pm2 start server.js --name aiddesk-signaling
 * 
 * Protocol:
 *   1. Client connects via WebSocket
 *   2. Client sends: { type: "register", deviceId: "XXX-XXX-XXX" }
 *   3. Client sends offers/answers/ice-candidates with a `target` deviceId
 *   4. Server routes the message to the target peer if online
 */

const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.PORT || '9090', 10);

// Map of deviceId -> WebSocket
const clients = new Map();

const wss = new WebSocketServer({ port: PORT }, () => {
  console.log(`[AidDesk Signaling] Listening on ws://0.0.0.0:${PORT}`);
  console.log('[AidDesk Signaling] Ready to relay WebRTC signaling messages');
});

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  let registeredId = null;

  console.log(`[Connect] New connection from ${ip}`);

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    switch (msg.type) {
      // ─── Registration: associate this WebSocket with a Device ID
      case 'register': {
        const deviceId = msg.deviceId;
        if (!deviceId || !/^\d{3}-\d{3}-\d{3}$/.test(deviceId)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid device ID format' }));
          return;
        }

        // If another connection has this ID, disconnect it (single-session per device)
        if (clients.has(deviceId) && clients.get(deviceId) !== ws) {
          const old = clients.get(deviceId);
          old.send(JSON.stringify({ type: 'error', message: 'Another session registered with your Device ID' }));
          old.close();
        }

        clients.set(deviceId, ws);
        registeredId = deviceId;
        console.log(`[Register] Device ${deviceId} from ${ip} (${clients.size} total)`);

        ws.send(JSON.stringify({ type: 'registered', deviceId }));
        break;
      }

      // ─── SDP Offer: client wants to connect to a target device
      case 'offer': {
        const target = clients.get(msg.target);
        if (!target || target.readyState !== 1) {
          ws.send(JSON.stringify({
            type: 'error',
            message: `Device ${msg.target} is not online`,
          }));
          return;
        }

        console.log(`[Offer] ${msg.from} -> ${msg.target}`);
        target.send(JSON.stringify({
          type: 'offer',
          sdp: msg.sdp,
          from: msg.from,
        }));
        break;
      }

      // ─── SDP Answer: host responds to the offer
      case 'answer': {
        const target = clients.get(msg.target);
        if (!target || target.readyState !== 1) return;

        console.log(`[Answer] ${msg.from} -> ${msg.target}`);
        target.send(JSON.stringify({
          type: 'answer',
          sdp: msg.sdp,
          from: msg.from,
        }));
        break;
      }

      // ─── ICE Candidate: relay NAT traversal data
      case 'ice-candidate': {
        const target = clients.get(msg.target);
        if (!target || target.readyState !== 1) return;

        target.send(JSON.stringify({
          type: 'ice-candidate',
          candidate: msg.candidate,
          from: msg.from,
        }));
        break;
      }

      // ─── Disconnect notification
      case 'disconnect': {
        const target = clients.get(msg.target);
        if (target && target.readyState === 1) {
          target.send(JSON.stringify({
            type: 'disconnect',
            from: msg.from,
          }));
        }
        console.log(`[Disconnect] ${msg.from} disconnected from ${msg.target}`);
        break;
      }

      default:
        ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${msg.type}` }));
    }
  });

  ws.on('close', () => {
    if (registeredId) {
      clients.delete(registeredId);
      console.log(`[Disconnect] Device ${registeredId} (${clients.size} remaining)`);
    }
  });

  ws.on('error', (err) => {
    console.error(`[Error] ${registeredId || 'Unknown'}:`, err.message);
  });
});

// ─── Heartbeat: detect and clean up dead connections ───

const HEARTBEAT_INTERVAL = 30_000;

const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      console.log('[Heartbeat] Terminating dead connection');
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);

wss.on('close', () => {
  clearInterval(heartbeat);
});

// ─── Graceful shutdown ───

function shutdown() {
  console.log('\n[Shutdown] Closing signaling server…');
  wss.clients.forEach((ws) => {
    ws.send(JSON.stringify({ type: 'error', message: 'Server shutting down' }));
    ws.close();
  });
  wss.close(() => {
    console.log('[Shutdown] Server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
