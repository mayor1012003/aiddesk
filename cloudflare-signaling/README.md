# AidDesk Signaling Server — Cloudflare Workers (free)

> **Live:** `https://aiddesk-signaling.mayor1012003.workers.dev`. This is the AidDesk app's **default** signaling server
> (`wss://aiddesk-signaling.mayor1012003.workers.dev`, set in `src/main/index.js`).
> Health check: <https://aiddesk-signaling.mayor1012003.workers.dev/healthz>

Always-on WebSocket signaling server for AidDesk, running on Cloudflare's free
Workers plan with Durable Objects. No credit card, no sleeping, no server to
start or stop. It uses the same protocol as `../signaling-server` (Node), so the
desktop app works with either one.

Protocol messages: `register` → `registered`, then `offer` / `answer` / `ice-candidate` /
`disconnect` relayed to `target`. `offer` may carry an `auth` object, the unattended-access password, which is relayed only to the target device. The app also embeds it in the SDP object, so older deployments work too. `disconnect` may carry a `reason`: `rejected`, `busy` or
`host-error`. The app sends `{"type":"ping"}` every 30 s as a heartbeat. The Worker answers
`{"type":"pong"}` through `setWebSocketAutoResponse`, so heartbeats don't wake the
hibernated Durable Object. **Redeploy (`npx wrangler deploy`) to get these.** Older
deployments still work with the new app, which ignores their "Unknown message type: ping"
reply.

## Deploy (from your Mac)

```bash
cd /Users/mayowa/Documents/aiddesk
git pull                          # get the latest code
cd cloudflare-signaling
npm install
npx wrangler login                # opens the browser; sign up / sign in to Cloudflare (free)
npx wrangler deploy
```

The first deploy asks you to pick a free `workers.dev` subdomain. When it's done
it prints your URL, for example:

```
https://aiddesk-signaling.<your-subdomain>.workers.dev
```

## Check it

Open `https://aiddesk-signaling.<your-subdomain>.workers.dev/healthz` in a
browser. You should see:

```json
{ "status": "ok", "service": "AidDesk Signaling Server (Cloudflare)", "connectedDevices": 0 }
```

## Point AidDesk at it

Nothing to do for the live deployment: the app already defaults to
`wss://aiddesk-signaling.mayor1012003.workers.dev`.

If you deploy to a different subdomain, override the default with `wss://` and your host:

```bash
SIGNALING_SERVER_URL=wss://aiddesk-signaling.<your-subdomain>.workers.dev npm run dev
```

## TURN relay (Cloudflare Realtime TURN, free tier)

STUN alone fails when either side is on mobile data (carrier-grade NAT) or behind a
strict corporate firewall. A TURN server relays the encrypted media in those cases.
This Worker hands out **short-lived** Cloudflare TURN credentials, so the long-lived
TURN key lives only in Worker secrets and never ships in the app.

### Endpoint

`GET /ice-servers?deviceId=XXX-XXX-XXX`. Returns:

```json
{
  "turnEnabled": true,
  "ttl": 86400,
  "expiresAt": "2026-11-20T21:56:50.586Z",
  "iceServers": [
    { "urls": ["stun:stun.cloudflare.com:3478"] },
    { "urls": ["turn:turn.cloudflare.com:3478?transport=udp", "...", "turns:turn.cloudflare.com:443?transport=tcp"],
      "username": "…", "credential": "…" }
  ]
}
```

- Credentials are generated with Cloudflare's
  `POST https://rtc.live.cloudflare.com/v1/turn/keys/{TURN_KEY_ID}/credentials/generate-ice-servers`
  (`{"ttl": 86400}`, i.e. 24 hours) and reused for up to 12 hours per Worker instance, so
  each handed-out credential has at least 12 hours of life left. Port-53 URLs are filtered out (browsers block them).
- **Fallback:** if the secrets aren't set, or Cloudflare's API fails, the endpoint
  returns `"turnEnabled": false`, a `reason` (`turn-not-configured`,
  `device-not-registered` or `turn-api-error`), and public STUN servers only. The
  app keeps working as before.
- **Abuse protection (simple):** TURN credentials are only returned when `deviceId`
  belongs to a device that is **currently connected and registered** on this
  signaling server (a running AidDesk app). The server waits up to ~2 seconds for
  the registration to arrive. Other requests get the STUN-only response. This stops
  casual scraping of the URL; it is not strong authentication (anyone who opens a
  WebSocket and registers an ID can get credentials), so watch usage in the dashboard.

### Set it up (one time, from your Mac)

1. Open the Cloudflare dashboard: <https://dash.cloudflare.com> → **Realtime** (left
   sidebar) → **TURN Server** → **Create** (name it e.g. `aiddesk`).
2. Copy the **Turn Token ID** and the **API Token** it shows. The API token is shown
   **only once**. Don't paste either into the repo or into chat.
3. Store them as Worker secrets and redeploy:

   ```bash
   cd /Users/mayowa/Documents/aiddesk
   git pull
   cd cloudflare-signaling
   npx wrangler secret put TURN_KEY_ID          # paste the Turn Token ID
   npx wrangler secret put TURN_KEY_API_TOKEN   # paste the API Token
   npx wrangler deploy
   ```

4. Verify: open
   <https://aiddesk-signaling.mayor1012003.workers.dev/ice-servers>. Without a
   registered `deviceId` you'll see `"reason": "device-not-registered"`. That means
   the secrets **are** set: the reason would be `turn-not-configured` if they weren't.
   When a session starts (the app registers first, then fetches ICE servers), the
   app's main-process log shows `[ICE] Loaded from signaling server (turnEnabled=true)`.
5. Optional, to prove the relay works: start the app with
   `AIDDESK_FORCE_RELAY=1 npm run dev` on one side. All traffic is then forced through TURN
   (`iceTransportPolicy: 'relay'`), so a successful connection means TURN works.

### Free tier

Cloudflare Realtime gives **1,000 GB of egress per month free** (TURN and SFU share
that allowance); beyond that it's **$0.05/GB**. STUN (`stun.cloudflare.com`) is free
and unlimited. Relayed traffic only happens when a direct P2P path fails, so typical
use stays well within the free tier. Check usage under **Realtime → TURN Server** in
the dashboard.

## Useful commands

| Command | What it does |
|---|---|
| `npx wrangler dev` | Run locally on http://localhost:8787 |
| `npx wrangler deploy` | Deploy / update |
| `npx wrangler tail` | Stream live logs |

## Free plan limits

100,000 requests/day. Opening a connection counts as 1 request and incoming
WebSocket messages count at 20:1, so one remote-support session uses only a
handful. Idle connections hibernate and cost nothing.
