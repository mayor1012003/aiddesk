/**
 * AidDesk Signaling Server
 *
 * A lightweight WebSocket server that relays WebRTC signaling messages
 * (SDP offers/answers and ICE candidates) between AidDesk peers.
 *
 * The server NEVER sees media content — it only routes signaling.
 * Peers go fully P2P (direct WebRTC) after the handshake.
 *
 * Deployment:
 *   Local:  node server.js
 *   Koyeb:  deploys automatically from GitHub (signaling-server/ subfolder)
 *   Env:    PORT is injected automatically by Koyeb / Railway / Fly.io
 *
 * Protocol:
 *   1. Client connects via WebSocket
 *   2. Client sends: { type: "register", deviceId: "XXX-XXX-XXX" }
 *   3. Client sends offers/answers/ice-candidates with a `target` deviceId
 *   4. Server routes the message to the target peer if online
 */

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.PORT || '9090', 10);

// Map of deviceId -> WebSocket
const clients = new Map();

// ─── HTTP server (required for Koyeb health checks) ─────────────────────────
// Koyeb (and most PaaS platforms) ping GET / or GET /healthz to confirm the
// service is alive. We attach the WebSocket server to this same HTTP server
// so everything shares one port.

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/')) {
    const status = {
      status: 'ok',
      service: 'AidDesk Signaling Server',
      connectedDevices: clients.size,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

// ─── WebSocket server (attached to the HTTP server) ─────────────────────────

const wss = new WebSocketServer({ server });

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[AidDesk Signaling] HTTP + WebSocket server listening on port ${PORT}`);
  console.log(`[AidDesk Signaling] Health check: http://0.0.0.0:${PORT}/healthz`);
  console.log(`[AidDesk Signaling] WebSocket:    ws://0.0.0.0:${PORT}`);
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

      // ─── Registration: associate this WebSocket with a Device ID ──────────
      case 'register': {
        const deviceId = msg.deviceId;
        if (!deviceId || !/^\d{3}-\d{3}-\d{3}$/.test(deviceId)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid device ID format' }));
          return;
        }

        // If another connection already has this ID, close it
        // (single session per device — prevents stale connections)
        if (clients.has(deviceId) && clients.get(deviceId) !== ws) {
          const old = clients.get(deviceId);
          old.send(JSON.stringify({
            type: 'error',
            message: 'Another session registered with your Device ID',
          }));
          old.close();
        }

        clients.set(deviceId, ws);
        registeredId = deviceId;
        console.log(`[Register] Device ${deviceId} from ${ip} (${clients.size} total online)`);

        ws.send(JSON.stringify({ type: 'registered', deviceId }));
        break;
      }

      // ─── SDP Offer: client wants to connect to a target device ───────────
      case 'offer': {
        const target = clients.get(msg.target);
        if (!target || target.readyState !== 1 /* OPEN */) {
          ws.send(JSON.stringify({
            type: 'error',
            message: `Device ${msg.target} is not online`,
          }));
          return;
        }

        console.log(`[Offer] ${msg.from} → ${msg.target}`);
        target.send(JSON.stringify({
          type: 'offer',
          sdp: msg.sdp,
          from: msg.from,
          requestId: msg.requestId,
        }));
        break;
      }

      // ─── SDP Answer: host responds to the offer ───────────────────────────
      case 'answer': {
        const target = clients.get(msg.target);
        if (!target || target.readyState !== 1) return;

        console.log(`[Answer] ${msg.from} → ${msg.target}`);
        target.send(JSON.stringify({
          type: 'answer',
          sdp: msg.sdp,
          from: msg.from,
        }));
        break;
      }

      // ─── ICE Candidate: relay NAT traversal data ─────────────────────────
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

      // ─── Disconnect notification ──────────────────────────────────────────
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
        ws.send(JSON.stringify({
          type: 'error',
          message: `Unknown message type: ${msg.type}`,
        }));
    }
  });

  ws.on('close', () => {
    if (registeredId) {
      clients.delete(registeredId);
      console.log(`[Offline] Device ${registeredId} (${clients.size} remaining online)`);
    }
  });

  ws.on('error', (err) => {
    console.error(`[Error] Device ${registeredId || 'unregistered'}:`, err.message);
  });
});

// ─── Heartbeat: detect and clean up dead connections ─────────────────────────
// Koyeb keeps idle connections alive, but we still ping every 30s to detect
// clients that dropped without sending a close frame.

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

wss.on('close', () => clearInterval(heartbeat));

// ─── Graceful shutdown (SIGTERM sent by Koyeb on redeploy / scale-down) ──────

function shutdown(signal) {
  console.log(`\n[Shutdown] Received ${signal}, closing server gracefully…`);
  clearInterval(heartbeat);

  wss.clients.forEach((ws) => {
    ws.send(JSON.stringify({ type: 'error', message: 'Server is restarting, please reconnect' }));
    ws.close();
  });

  server.close(() => {
    console.log('[Shutdown] HTTP server closed');
    process.exit(0);
  });

  // Force-quit after 10s if connections don't close cleanly
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
