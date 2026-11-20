# AidDesk — Cross-Platform Remote Desktop

> A secure, cross-platform remote desktop application for IT troubleshooting.
> Built with Electron + React, using WebRTC for peer-to-peer screen sharing with end-to-end encryption.

![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-brightgreen)

## Features

- 💻 **Remote Screen Viewing** — Real-time screen sharing via WebRTC
- 🖱️ **Mouse & Keyboard Control** — Full remote input injection via robotjs
- 🔒 **End-to-End Encryption** — DTLS/SRTP built into WebRTC; signaling server never sees media
- 🔐 **Interactive Approval** — Incoming connections require explicit Accept/Deny
- 📱 **Unattended Access** — Optional password (Argon2id hashed) + TOTP 2FA
- 🛡️ **ACL Whitelist** — Pre-approve trusted devices
- ⚠️ **Lockout Protection** — 5 failed attempts = 60-second lockout
- 💬 **Text Chat** — Real-time chat alongside the remote session
- 📁 **File Transfer** — Chunked file transfer over WebRTC DataChannel
- 📮 **Clipboard Sync** — Automatic clipboard synchronization
- 🎥 **Session Recording** — Record sessions as .webm files
- 📖 **Address Book** — Save and organize remote devices
- 📜 **Session Logging** — Full history with timestamps and duration
- 🎙️ **Quality Control** — Auto/High/Medium/Low quality presets

## For your team (no Node.js or npm needed)

1. **Download** the installer from this repo's **Releases** page
   (<https://github.com/mayor1012003/aiddesk/releases/latest>):
   - Windows: `AidDesk-Setup-<version>-x64.exe`
   - Mac with Apple silicon (M1–M4): `AidDesk-<version>-arm64.dmg`
   - Intel Mac: `AidDesk-<version>-x64.dmg` (when it's attached)
2. **Install and allow it on first run.** The builds aren't code-signed yet, so:
   - **Windows:** if SmartScreen says "Windows protected your PC", click **More info → Run anyway**.
   - **macOS:** drag AidDesk into Applications, then run this once in Terminal:
     `xattr -cr /Applications/AidDesk.app`. Or try to open it, then go to
     System Settings → Privacy & Security → **Open Anyway**.
   - **macOS permissions:** in System Settings → Privacy & Security, turn on
     **Screen Recording** and **Accessibility** for AidDesk. Then quit it from the
     menu bar icon and reopen it.
3. **It stays running.** AidDesk starts automatically when you log in and lives in the
   system tray (Windows) or the menu bar (macOS). Closing the window only hides it.
   To really quit, use the tray icon → **Quit AidDesk**. You can turn off "Start AidDesk
   when I log in" in Settings or in the tray menu.
4. **Reachability.** A computer can be reached whenever it's **powered on, logged in and
   connected to the internet**. Its status reads *Online — ready for connections*. The
   signaling server runs 24/7 in the cloud, but a PC that is off, asleep or logged out
   can't be reached.
5. **Connecting without someone at the other PC:** on that PC, set an **Unattended Access
   Password** in Settings (plus 2FA if you like). To connect to it, enter its Device ID
   and that password (and the 2FA code) on the Dashboard. Leave the password empty if you
   want the person there to click **Accept**. Five wrong attempts lock the caller out for
   60 seconds.

**Automatic installer builds (one-time setup).** The workflow is stored at `ci/build.yml`. GitHub
only runs it from `.github/workflows/`, so add it once in the browser:
1. On GitHub, open the repo → **Add file → Create new file**.
2. Name it `.github/workflows/build.yml`, paste the contents of
   [`ci/build.yml`](ci/build.yml), and click **Commit changes** on `main`.
3. Under **Releases → Draft a new release**, type the tag `v1.0.1` (choose
   "Create new tag on publish") and publish it. Or from a terminal:
   `git pull && git tag v1.0.1 && git push origin v1.0.1`.
   Then watch the **Actions** tab. After about 15 minutes the Windows `.exe` and the
   macOS `.dmg` files are attached to the release.

**Later releases:** bump `version` in `package.json`, commit, then
`git tag vX.Y.Z && git push origin vX.Y.Z`.

## Prerequisites

| Requirement | Version |
|-------------|--------|
| Node.js | >= 18 |
| Python | 3.x (for robotjs native compilation) |
| **Windows** | Visual Studio Build Tools (C++ workload) |
| **macOS** | Xcode Command Line Tools (`xcode-select --install`) |
| **Linux** | `build-essential`, `libx11-dev`, `libxtst-dev`, `libpng++-dev` |

## Quick Start

### 1. Install Dependencies

```bash
cd aiddesk
npm install
```

### 2. Rebuild Native Modules

robotjs (installed as [`@jitsi/robotjs`](https://www.npmjs.com/package/@jitsi/robotjs) through an npm alias, with prebuilt binaries for Apple silicon and Intel) and better-sqlite3 need to be rebuilt for Electron:

```bash
npm run rebuild
```

### 3. Signaling Server (already live, nothing to start)

By default the app connects to the live Cloudflare Workers signaling server:

```
wss://aiddesk-signaling.mayor1012003.workers.dev
```

To test against the local Node server instead, start it in a separate terminal
and point the app at it with the `SIGNALING_SERVER_URL` environment variable:

```bash
cd signaling-server
npm install
node server.js                     # listens on ws://localhost:9090

# in the app terminal:
SIGNALING_SERVER_URL=ws://localhost:9090 npm run dev
```

**How the app uses it:** every AidDesk instance connects and registers its Device ID
as soon as it opens, so another PC can connect to it right away. Nobody has to click
anything on the host. The connection reconnects on its own with backoff after network
changes, sleep/wake or a server restart, and re-registers each time. A `ping` heartbeat
every 30 s detects dead connections. The status bar and the Dashboard show the live
state: **Online**, **Connecting**, **Offline — reconnecting** or **Device ID in use
elsewhere**. If another window or PC registers the same Device ID, the older one stops
reconnecting. Outgoing connections reuse this same socket.

### 4. Run in Development

```bash
npm run dev
```

This starts webpack in watch mode and launches Electron.

## Build for Distribution

```bash
# Windows (.exe installer)
npm run build:win

# macOS (.dmg)
npm run build:mac

# Linux (.AppImage)
npm run build:linux
```

Built packages will be in the `release/` directory.

## Project Structure

```
aiddesk/
├── package.json               # Electron app dependencies & scripts
├── electron-builder.yml       # Packaging configuration
├── webpack.renderer.config.js # React/renderer bundler config
├── .env.example               # Environment configuration template
├── cloudflare-signaling/      # Live signaling server (Cloudflare Workers), the app default
│   ├── src/
│   ├── wrangler.toml
│   └── README.md
├── signaling-server/          # Alternative self-hosted Node.js signaling server
│   ├── server.js
│   ├── package.json
│   └── DEPLOY.md              # Deployment guide
├── public/
│   └── index.html             # Renderer HTML template
├── src/
│   ├── main/                  # Electron main process
│   │   ├── index.js           # App entry point
│   │   ├── preload.js         # Secure contextBridge
│   │   ├── ipcHandlers.js     # All IPC channel registrations
│   │   ├── deviceId.js        # Unique device ID generation
│   │   ├── database.js        # SQLite setup & migrations
│   │   ├── auth.js            # Password + TOTP 2FA + lockout
│   │   ├── screenCapture.js   # desktopCapturer wrapper
│   │   ├── inputControl.js    # robotjs mouse/keyboard injection
│   │   ├── fileTransfer.js    # Chunked file transfer handlers
│   │   └── sessionRecorder.js # Session recording file management
│   └── renderer/              # React frontend
│       ├── index.jsx          # Entry point
│       ├── App.jsx            # Root component with state management
│       ├── styles/global.css   # Dark mode styles
│       └── components/
│           ├── Dashboard.jsx          # Main screen: Device ID + connect
│           ├── RemoteView.jsx         # Live screen + input capture
│           ├── ChatPanel.jsx          # Chat sidebar
│           ├── FileManager.jsx        # File transfer UI
│           ├── AddressBook.jsx        # Saved devices
│           ├── SessionLog.jsx         # Session history
│           ├── Settings.jsx           # Security & preferences
│           ├── ConnectionRequest.jsx  # Incoming approval dialog
│           └── StatusBar.jsx          # Connection indicator
└── assets/                    # Icons: icon.svg (source), icon.png, icon.icns (mac), icon.ico (win)
```

## Configuring the Signaling Server URL

**Default:** `wss://aiddesk-signaling.mayor1012003.workers.dev`, the live Cloudflare Worker in
`cloudflare-signaling/`. No configuration needed; packaged builds use it automatically.

To use a different server, set the `SIGNALING_SERVER_URL` environment variable when
launching the app (it overrides the default):

```bash
SIGNALING_SERVER_URL=ws://your-server-ip:9090 npm run dev     # self-hosted Node server
SIGNALING_SERVER_URL=wss://signal.yourdomain.com npm run dev  # self-hosted with TLS
```

See `cloudflare-signaling/README.md` (Cloudflare) or `signaling-server/DEPLOY.md`
(Node) for deployment instructions.

## Security Architecture

1. **Transport Encryption**: All media streams use WebRTC DTLS/SRTP (end-to-end encrypted). The signaling server only exchanges SDP/ICE — it never sees screen content.

2. **Authentication**: Unattended access passwords are hashed with Argon2id (with PBKDF2 fallback). Optional TOTP 2FA via Google Authenticator.

3. **Authorization**: Interactive approval dialogs for unknown devices. ACL whitelist for trusted devices.

4. **Lockout**: 5 failed password attempts triggers a 60-second lockout per device.

5. **Device Identity**: Cryptographically random 9-digit IDs. Non-guessable and persistent.

6. **Session Isolation**: Ephemeral session tokens, not stored after disconnect.

7. **Context Isolation**: Electron's contextBridge with `contextIsolation: true` and `nodeIntegration: false`.

## STUN/TURN Servers

Before each connection, the app (main process) fetches its ICE servers from the
signaling server's `GET /ice-servers` endpoint (`https://` derived from the `wss://`
signaling URL). Both the caller and the host use that config for their
`RTCPeerConnection`.

- **TURN relay:** Cloudflare Realtime TURN (free tier: 1,000 GB/month), with
  short-lived credentials generated by the Worker. The TURN key is stored only as
  Worker secrets. Setup: see [`cloudflare-signaling/README.md` → TURN relay](cloudflare-signaling/README.md#turn-relay-cloudflare-realtime-turn-free-tier).
- **Fallback:** if TURN isn't configured or the fetch fails, the app uses STUN only
  (`STUN_SERVERS`, default `stun:stun.l.google.com:19302`), as before.
- **Test the relay:** `AIDDESK_FORCE_RELAY=1 npm run dev` forces `iceTransportPolicy: 'relay'`.
- Extra static TURN servers can still be added with `TURN_SERVERS` / `TURN_USERNAME`
  / `TURN_CREDENTIAL`; they are appended to the fetched list.

## License

MIT © AidDesk Team
