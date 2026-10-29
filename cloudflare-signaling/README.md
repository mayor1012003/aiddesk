# AidDesk Signaling Server — Cloudflare Workers (free)

Always-on WebSocket signaling server for AidDesk, running on Cloudflare's free
Workers plan with Durable Objects. No credit card, no sleeping, no server to
start or stop. It uses the same protocol as `../signaling-server` (Node), so the
desktop app works with either one.

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

Use `wss://` (secure WebSocket) with the same host:

```bash
SIGNALING_SERVER_URL=wss://aiddesk-signaling.<your-subdomain>.workers.dev npm run dev
```

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
