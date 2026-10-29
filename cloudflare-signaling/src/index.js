/**
 * AidDesk Signaling Server — Cloudflare Workers + Durable Objects edition.
 *
 * Same wire protocol as signaling-server/server.js (Node version), so the
 * desktop app works with either one unchanged:
 *   1. Client opens a WebSocket to wss://<worker>.workers.dev
 *   2. Client sends { type: "register", deviceId: "XXX-XXX-XXX" }
 *   3. offer / answer / ice-candidate / disconnect messages carry a `target`
 *      deviceId and are relayed to that peer.
 *
 * All sockets are held by ONE Durable Object ("hub") so any two devices can
 * find each other. The WebSocket Hibernation API is used, so idle connections
 * cost nothing on the free plan. The server only relays signaling — media
 * flows peer-to-peer over WebRTC (DTLS/SRTP) and never touches Cloudflare.
 */

const DEVICE_ID_RE = /^\d{3}-\d{3}-\d{3}$/;
const OPEN = 1;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') === 'websocket') {
      const hub = env.SIGNALING_HUB.get(env.SIGNALING_HUB.idFromName('global'));
      return hub.fetch(request);
    }

    if (url.pathname === '/' || url.pathname === '/healthz') {
      const hub = env.SIGNALING_HUB.get(env.SIGNALING_HUB.idFromName('global'));
      const res = await hub.fetch(new Request(new URL('/stats', url), { method: 'GET' }));
      const stats = await res.json();
      return Response.json({
        status: 'ok',
        service: 'AidDesk Signaling Server (Cloudflare)',
        connectedDevices: stats.connectedDevices,
        timestamp: new Date().toISOString(),
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};

export class SignalingHub {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/stats') {
      return Response.json({ connectedDevices: this.registeredSockets().length });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ deviceId: null });
    return new Response(null, { status: 101, webSocket: client });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  registeredSockets() {
    return this.state.getWebSockets().filter((ws) => ws.deserializeAttachment()?.deviceId);
  }

  findDevice(deviceId) {
    return this.state
      .getWebSockets()
      .find((ws) => ws.deserializeAttachment()?.deviceId === deviceId && ws.readyState === OPEN);
  }

  send(ws, obj) {
    try {
      ws.send(JSON.stringify(obj));
    } catch {
      /* socket already gone */
    }
  }

  // ─── Hibernation API handlers ──────────────────────────────────────────────

  async webSocketMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return this.send(ws, { type: 'error', message: 'Invalid JSON' });
    }

    switch (msg.type) {
      case 'register': {
        if (!msg.deviceId || !DEVICE_ID_RE.test(msg.deviceId)) {
          return this.send(ws, { type: 'error', message: 'Invalid device ID format' });
        }
        // Single session per device: close any older socket with the same ID
        const existing = this.findDevice(msg.deviceId);
        if (existing && existing !== ws) {
          this.send(existing, { type: 'error', message: 'Another session registered with your Device ID' });
          existing.serializeAttachment({ deviceId: null });
          existing.close(4000, 'Replaced by newer session');
        }
        ws.serializeAttachment({ deviceId: msg.deviceId });
        return this.send(ws, { type: 'registered', deviceId: msg.deviceId });
      }

      case 'offer': {
        const target = this.findDevice(msg.target);
        if (!target) {
          return this.send(ws, { type: 'error', message: `Device ${msg.target} is not online` });
        }
        return this.send(target, { type: 'offer', sdp: msg.sdp, from: msg.from, requestId: msg.requestId });
      }

      case 'answer': {
        const target = this.findDevice(msg.target);
        if (target) this.send(target, { type: 'answer', sdp: msg.sdp, from: msg.from });
        return;
      }

      case 'ice-candidate': {
        const target = this.findDevice(msg.target);
        if (target) this.send(target, { type: 'ice-candidate', candidate: msg.candidate, from: msg.from });
        return;
      }

      case 'disconnect': {
        const target = this.findDevice(msg.target);
        if (target) this.send(target, { type: 'disconnect', from: msg.from });
        return;
      }

      default:
        return this.send(ws, { type: 'error', message: `Unknown message type: ${msg.type}` });
    }
  }

  async webSocketClose(ws, code) {
    ws.serializeAttachment({ deviceId: null });
    try {
      ws.close(code === 1005 ? 1000 : code, 'closed');
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws) {
    ws.serializeAttachment({ deviceId: null });
  }
}
