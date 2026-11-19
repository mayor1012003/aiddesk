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

// ─── TURN / ICE servers ──────────────────────────────────────────────────────
// Short-lived TURN credentials come from Cloudflare Realtime TURN. The long-lived
// TURN key (TURN_KEY_ID + TURN_KEY_API_TOKEN) stays in Worker secrets and is never
// sent to the app. Without the secrets (or if Cloudflare's API fails) we return
// public STUN servers only, so the app keeps working exactly as before.
const TURN_API = 'https://rtc.live.cloudflare.com/v1/turn/keys';
const TURN_TTL_SECONDS = 86400; // credentials live 24h
const TURN_REUSE_SECONDS = 43200; // reuse cached creds while ≥12h of life remain
const STUN_FALLBACK = [
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
];
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Per-isolate cache so a burst of requests doesn't mint a new credential each time.
let turnCache = null; // { iceServers, expiresAt (ms) }

function iceJson(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { ...CORS_HEADERS, 'Cache-Control': 'private, no-store' },
  });
}

/** Ask the hub whether deviceId is currently registered, retrying briefly to cover
 *  the race where the app fetches ICE servers right after sending `register`. */
async function isDeviceOnline(env, deviceId) {
  const hub = env.SIGNALING_HUB.get(env.SIGNALING_HUB.idFromName('global'));
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await hub.fetch(`https://hub/online?deviceId=${encodeURIComponent(deviceId)}`);
    if ((await res.json()).online) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function generateTurnIceServers(env) {
  const now = Date.now();
  if (turnCache && turnCache.expiresAt - now > TURN_REUSE_SECONDS * 1000) return turnCache;

  const res = await fetch(`${TURN_API}/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
  });
  if (!res.ok) throw new Error(`Cloudflare TURN API returned ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.iceServers) || data.iceServers.length === 0) {
    throw new Error('Cloudflare TURN API returned no iceServers');
  }
  // Drop port-53 URLs: browsers/Chromium block them and they only cause timeouts.
  const iceServers = data.iceServers
    .map((s) => {
      const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u));
      return { ...s, urls };
    })
    .filter((s) => s.urls.length > 0);

  turnCache = { iceServers, expiresAt: now + TURN_TTL_SECONDS * 1000 };
  return turnCache;
}

async function handleIceServers(request, env, url) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== 'GET') return iceJson({ error: 'Method not allowed' }, 405);

  const stunOnly = (reason) =>
    iceJson({ turnEnabled: false, reason, ttl: null, expiresAt: null, iceServers: STUN_FALLBACK });

  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return stunOnly('turn-not-configured');

  // Abuse protection: only hand TURN credentials to a device that is currently
  // registered on this signaling server (i.e. a running AidDesk app).
  const deviceId = url.searchParams.get('deviceId') || '';
  if (!DEVICE_ID_RE.test(deviceId) || !(await isDeviceOnline(env, deviceId))) {
    return stunOnly('device-not-registered');
  }

  try {
    const { iceServers, expiresAt } = await generateTurnIceServers(env);
    return iceJson({
      turnEnabled: true,
      ttl: Math.floor((expiresAt - Date.now()) / 1000),
      expiresAt: new Date(expiresAt).toISOString(),
      iceServers,
    });
  } catch (err) {
    console.error('[ice-servers] TURN credential generation failed:', err.message);
    return stunOnly('turn-api-error');
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/ice-servers') {
      return handleIceServers(request, env, url);
    }

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

    if (url.pathname === '/online') {
      return Response.json({ online: Boolean(this.findDevice(url.searchParams.get('deviceId'))) });
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
