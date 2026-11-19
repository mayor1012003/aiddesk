/**
 * SignalingClient — one persistent, auto-reconnecting WebSocket to the AidDesk
 * signaling server per app instance.
 *
 * - Connects as soon as start() is called (App does this once the device ID is known),
 *   sends { type: 'register', deviceId } on every (re)connect and is "online" only after
 *   the server answers { type: 'registered' }.
 * - Reconnects with exponential backoff + jitter (network change, server/Durable Object
 *   restart, sleep/wake). A close with code 4000 ("Replaced by newer session") means the
 *   same Device ID registered elsewhere, so it stops instead of fighting over the ID.
 * - Heartbeat: sends the exact string {"type":"ping"} every 30s; any incoming message
 *   (normally {"type":"pong"}) proves liveness. No traffic within the timeout ⇒ the
 *   socket is treated as dead and replaced. Works with servers that don't know "ping"
 *   (their "Unknown message type" error also counts as traffic and is swallowed).
 * - Framework-free (no React) so it can be exercised from Node in tests; pass
 *   WebSocketImpl (e.g. the `ws` package) outside the browser.
 */

export const SignalingStatus = Object.freeze({
  OFFLINE: 'offline',       // not connected; a reconnect is scheduled (unless stopped)
  CONNECTING: 'connecting', // socket opening or waiting for "registered"
  ONLINE: 'online',         // registered — reachable by other devices
  REPLACED: 'replaced',     // another instance registered this Device ID; not reconnecting
});

const PING_FRAME = '{"type":"ping"}';
const WS_CONNECTING = 0;
const WS_OPEN = 1;

export class SignalingClient {
  constructor({
    url,
    deviceId,
    WebSocketImpl = globalThis.WebSocket,
    heartbeatIntervalMs = 30_000,
    heartbeatTimeoutMs = 10_000,
    registerTimeoutMs = 10_000,
    minBackoffMs = 1_000,
    maxBackoffMs = 30_000,
    logger = console,
  }) {
    if (!url) throw new Error('SignalingClient: url is required');
    if (!deviceId) throw new Error('SignalingClient: deviceId is required');
    Object.assign(this, {
      url, deviceId, WebSocketImpl, heartbeatIntervalMs, heartbeatTimeoutMs,
      registerTimeoutMs, minBackoffMs, maxBackoffMs, logger,
    });
    this.status = SignalingStatus.OFFLINE;
    this.ws = null;
    this.started = false;
    this.attempt = 0;
    this.lastSeen = 0;
    this.connectCount = 0; // number of successful registrations (for diagnostics/tests)
    this.timers = { reconnect: null, register: null, heartbeat: null, probe: null };
    this.messageListeners = new Set();
    this.statusListeners = new Set();
    this.waiters = new Set();
    this._onBrowserOnline = () => this.reconnectNow();
    this._onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') this.checkNow();
    };
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  start() {
    if (this.started) return;
    this.started = true;
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('online', this._onBrowserOnline);
      document?.addEventListener?.('visibilitychange', this._onVisibility);
    }
    this._connect();
  }

  stop() {
    this.started = false;
    if (typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('online', this._onBrowserOnline);
      document?.removeEventListener?.('visibilitychange', this._onVisibility);
    }
    Object.keys(this.timers).forEach((k) => this._clear(k));
    this._dropSocket('client stopped');
    this._setStatus(SignalingStatus.OFFLINE);
    this._rejectWaiters(new Error('Signaling client stopped'));
  }

  /** Subscribe to every server message except pong. Returns an unsubscribe function. */
  onMessage(fn) {
    this.messageListeners.add(fn);
    return () => this.messageListeners.delete(fn);
  }

  /** Subscribe to status changes; called immediately with the current status. */
  onStatus(fn) {
    this.statusListeners.add(fn);
    fn(this.status);
    return () => this.statusListeners.delete(fn);
  }

  isOnline() {
    return this.status === SignalingStatus.ONLINE && this.ws?.readyState === WS_OPEN;
  }

  /** Send a JSON message over the registered socket. Returns false if not online. */
  send(obj) {
    if (!this.isOnline()) return false;
    try {
      this.ws.send(JSON.stringify(obj));
      return true;
    } catch (err) {
      this.logger.warn?.('[Signaling] send failed:', err?.message || err);
      return false;
    }
  }

  /** Resolve once registered (immediately if already online). Starts/expedites connecting. */
  waitUntilRegistered(timeoutMs = 10_000) {
    if (this.isOnline()) return Promise.resolve(this);
    if (this.status === SignalingStatus.REPLACED) {
      return Promise.reject(new Error('This Device ID is in use by another AidDesk instance'));
    }
    if (!this.started) this.start();
    else this.reconnectNow();
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: () => { clearTimeout(waiter.timer); resolve(this); },
        reject: (err) => { clearTimeout(waiter.timer); reject(err); },
      };
      waiter.timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error('Could not reach the signaling server'));
      }, timeoutMs);
      this.waiters.add(waiter);
    });
  }

  /** Skip the remaining backoff and connect now (e.g. network came back). */
  reconnectNow() {
    if (!this.started) return;
    if (this.status === SignalingStatus.REPLACED) return;
    const rs = this.ws?.readyState;
    if (rs === WS_OPEN || rs === WS_CONNECTING) return;
    this.attempt = 0;
    this._clear('reconnect');
    this._connect();
  }

  /** Verify the connection right now (after wake / visibility change). */
  checkNow() {
    if (!this.started) return;
    if (this.ws?.readyState === WS_OPEN) this._probe();
    else this.reconnectNow();
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  _connect() {
    if (!this.started) return;
    const rs = this.ws?.readyState;
    if (rs === WS_OPEN || rs === WS_CONNECTING) return; // never open a second socket
    this._clear('reconnect');
    this._setStatus(SignalingStatus.CONNECTING);

    let ws;
    try {
      ws = new this.WebSocketImpl(this.url);
    } catch (err) {
      this.logger.error?.('[Signaling] Could not create WebSocket:', err?.message || err);
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (ws !== this.ws) return;
      this.lastSeen = Date.now();
      ws.send(JSON.stringify({ type: 'register', deviceId: this.deviceId }));
      this._clear('register');
      this.timers.register = setTimeout(() => {
        this.logger.warn?.('[Signaling] No "registered" reply — reconnecting');
        this._handleSocketGone(ws, null, 'register timeout');
      }, this.registerTimeoutMs);
    };

    ws.onmessage = (event) => {
      if (ws !== this.ws) return;
      this.lastSeen = Date.now();
      let msg;
      try {
        msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'pong') return;
      if (msg.type === 'error' && /unknown message type: ping/i.test(msg.message || '')) return;
      if (msg.type === 'registered' && msg.deviceId === this.deviceId) {
        this._clear('register');
        this.attempt = 0;
        this.connectCount += 1;
        this._startHeartbeat();
        this._setStatus(SignalingStatus.ONLINE);
        this.logger.log?.('[Signaling] Registered as', this.deviceId);
        this.waiters.forEach((w) => w.resolve());
        this.waiters.clear();
      }
      this.messageListeners.forEach((fn) => {
        try { fn(msg); } catch (err) { this.logger.error?.('[Signaling] listener error:', err); }
      });
    };

    ws.onerror = () => {
      if (ws !== this.ws) return;
      this.logger.warn?.('[Signaling] WebSocket error');
      // A close event normally follows; the heartbeat/register timers cover the rest.
    };

    ws.onclose = (event) => {
      this._handleSocketGone(ws, event?.code ?? null, event?.reason || 'closed');
    };
  }

  _handleSocketGone(ws, code, reason) {
    if (ws !== this.ws) return; // an old, already-abandoned socket
    this._dropSocket(reason);
    this._clear('register');
    this._stopHeartbeat();
    if (!this.started) return;
    if (code === 4000) {
      this.logger.warn?.('[Signaling] Device ID registered by another instance; not reconnecting');
      this._setStatus(SignalingStatus.REPLACED);
      this._rejectWaiters(new Error('This Device ID is in use by another AidDesk instance'));
      return;
    }
    this.logger.log?.(`[Signaling] Disconnected (${code ?? '-'} ${reason}); reconnecting`);
    this._setStatus(SignalingStatus.OFFLINE);
    this._scheduleReconnect();
  }

  /** Detach and close the current socket without triggering our handlers. */
  _dropSocket(reason) {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    try {
      if (ws.readyState === WS_OPEN || ws.readyState === WS_CONNECTING) ws.close(1000, String(reason).slice(0, 100));
    } catch { /* ignore */ }
  }

  _scheduleReconnect() {
    if (!this.started || this.timers.reconnect) return;
    const base = Math.min(this.maxBackoffMs, this.minBackoffMs * 2 ** this.attempt);
    const delay = Math.round(base * (0.5 + Math.random() * 0.5));
    this.attempt += 1;
    this.timers.reconnect = setTimeout(() => {
      this.timers.reconnect = null;
      this._connect();
    }, delay);
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.timers.heartbeat = setInterval(() => this._probe(), this.heartbeatIntervalMs);
  }

  _stopHeartbeat() {
    this._clear('heartbeat');
    this._clear('probe');
  }

  _probe() {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN || this.timers.probe) return;
    const sentAt = Date.now();
    try { ws.send(PING_FRAME); } catch { /* handled by timeout */ }
    this.timers.probe = setTimeout(() => {
      this.timers.probe = null;
      if (ws === this.ws && this.lastSeen < sentAt) {
        this.logger.warn?.('[Signaling] Heartbeat timed out — reconnecting');
        this._handleSocketGone(ws, null, 'heartbeat timeout');
      }
    }, this.heartbeatTimeoutMs);
  }

  _setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((fn) => {
      try { fn(status); } catch (err) { this.logger.error?.('[Signaling] status listener error:', err); }
    });
  }

  _rejectWaiters(err) {
    this.waiters.forEach((w) => w.reject(err));
    this.waiters.clear();
  }

  _clear(name) {
    if (!this.timers[name]) return;
    clearTimeout(this.timers[name]);
    clearInterval(this.timers[name]);
    this.timers[name] = null;
  }
}

// ─── App-wide singleton ────────────────────────────────────────────────────
// One socket per app instance, even across React StrictMode double-mounts and
// re-renders. A different url/deviceId replaces the old client.

let shared = null;

export function getSignalingClient({ url, deviceId, ...options }) {
  if (shared && shared.url === url && shared.deviceId === deviceId) return shared;
  if (shared) shared.stop();
  shared = new SignalingClient({ url, deviceId, ...options });
  return shared;
}
