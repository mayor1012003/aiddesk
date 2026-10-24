# AidDesk Signaling Server — Deployment Guide

## Overview

The signaling server is a lightweight Node.js WebSocket server that relays WebRTC signaling messages (SDP offers/answers and ICE candidates) between AidDesk peers. **It never sees or handles media content** — all screen data travels directly peer-to-peer via WebRTC.

## Quick Start

```bash
cd signaling-server
npm install
node server.js
```

The server will start on port **9090** by default.

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `9090` | WebSocket listen port |

```bash
PORT=8443 node server.js
```

## Deployment Options

### 1. PM2 (Recommended for VPS)

```bash
npm install -g pm2
pm2 start server.js --name aiddesk-signaling
pm2 save
pm2 startup  # Auto-start on reboot
```

### 2. systemd Service

Create `/etc/systemd/system/aiddesk-signaling.service`:

```ini
[Unit]
Description=AidDesk Signaling Server
After=network.target

[Service]
Type=simple
User=aiddesk
WorkingDirectory=/opt/aiddesk/signaling-server
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=PORT=9090

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable aiddesk-signaling
sudo systemctl start aiddesk-signaling
```

### 3. Docker

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY server.js .
EXPOSE 9090
CMD ["node", "server.js"]
```

```bash
docker build -t aiddesk-signaling .
docker run -d -p 9090:9090 --name aiddesk-signaling aiddesk-signaling
```

## SSL/TLS (Production)

For production use, put the signaling server behind a reverse proxy (Nginx, Caddy) that terminates TLS:

**Nginx example:**

```nginx
server {
    listen 443 ssl;
    server_name signal.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/signal.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/signal.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:9090;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Then set `SIGNALING_SERVER_URL=wss://signal.yourdomain.com` in the AidDesk app.

## Client Configuration

In the AidDesk app's `.env` file:

```env
SIGNALING_SERVER_URL=ws://your-server-ip:9090
# Or with TLS:
SIGNALING_SERVER_URL=wss://signal.yourdomain.com
```

## Security Notes

- The signaling server only exchanges SDP/ICE — it **never** sees screen content or input events
- All media is encrypted end-to-end via WebRTC DTLS/SRTP
- For production, always use WSS (TLS) to protect signaling messages
- Consider adding rate limiting and authentication for the signaling server in production
- The server enforces one connection per Device ID (new connections boot old ones)
