# NabuLink

**Open-source, self-hosted, consent-first device pairing with an MCP adapter.**

Status: **0.1.0 proof of concept**. Tested core pairing, authenticated WebSocket command transport, revocation, and capability checks. This is **not** a remote desktop, VPN, or firewall bypass product yet.

## What it does

- Linux server with a browser-based administrator dashboard, one-time pairing codes (5 minutes), and durable device credentials.
- Windows / macOS / Linux Node.js 22+ agent: outgoing HTTPS/WSS only (no router port forwarding).
- Auto reconnect, WebSocket heartbeat, explicit device revocation, and per-device capability allowlisting.
- MCP **stdio** bridge via official MCP TypeScript SDK v2.
- Safe initial capabilities: `device.info`, `camera.capabilities` (non-capturing, reports unsupported until driver integration), and optional `speech.speak` (only with agent `--allow-speech`).
- **Does not provide arbitrary shell execution, secret retrieval, background camera capture, or hidden recording.**

## Transport roadmap

- v0.1: WebSocket over HTTPS (signaling + small control responses).
- v0.2: WebRTC for authorized media/data channels. TURN fallback (UDP + TCP/TLS), operator-hosted relay, no automatic recording.
- v0.3: gRPC over HTTP/2 for native-service calls where supported; WebSocket fallback for restrictive networks.
- Choose transport from measurements: RTT, packet loss, bandwidth, firewall availability and application stream type; do not hardcode a mythical universally fastest transport.
- Optional future DID / verifiable credentials can complement identity, but blockchain and metaverse are **not** core security dependencies. Avoid putting device metadata or sensitive keys on public ledgers.

## Install server — Docker & Coolify/Traefik

Requires Docker Compose, an external `coolify` network, and a public HTTPS DNS name.

```sh
git clone https://github.com/NabuxAi/NabuLink.git
cd NabuLink
cp .env.example .env
# Set NBL_DOMAIN and generate NBL_ADMIN_TOKEN with: openssl rand -hex 32
docker compose up -d --build
```

An optional Linux installer is included for environments with Docker installed:

```sh
sudo NBL_DOMAIN=link.example.com bash scripts/install-server.sh
```

The dashboard is available on `https://YOUR_DOMAIN/`. It requires the administrator token; never put the token in a URL.

## Install agent

Node.js **22+** required. Choose a trusted server that you control:

```sh
npm install --global github:NabuxAi/NabuLink
nabulink-agent --server https://YOUR_DOMAIN --name MyMac
```

Windows installation (review script first):

```powershell
irm https://raw.githubusercontent.com/NabuxAi/NabuLink/main/scripts/install.ps1 | iex
```

Alternatively clone and run `npm ci`; the script deliberately does not start in the background.

First-run agent displays a one-time pairing code. On the server dashboard enter the admin token, enter the code and approve. Agent credentials are saved in `~/.nabulink/agent.json` with restricted file permissions. To enable audible speech on your device, add `--allow-speech` when starting that agent. The local user must approve permissions.

## MCP for ChatGPT / Claude / developer clients

The adapter uses the official MCP SDK with **stdio**. Configure MCP client to run `nabulink-mcp` with `NBL_SERVER_URL=https://YOUR_DOMAIN` and `NBL_ADMIN_TOKEN` supplied by a local secret store. Supported tools:

`nabulink_list_devices`, `nabulink_device_info`, `nabulink_camera_capabilities`, `nabulink_speak`.

Avoid exposing the administrator token or bearer credentials in a public remote MCP URL.

## Security model

- New device credentials issued **only** after administrator approval of short-lived pairing code.
- Device credentials are stored as SHA-256 verifiers server-side, plaintext only in the local agent configuration.
- TLS is required for non-localhost agent traffic; per-device capabilities are opt-in.
- Restrict internet exposure to the reverse proxy. Never publish port 8787 to the Internet directly.
- Server records only minimal access logs, not audio or video.
- Agent must be installed intentionally; no stealth background service.
- **Before production:** implement audited end-to-end device identity exchange (not just TLS to the server), enterprise login, RBAC, persistent audit log, request confirmation for sensitive actions, rate limits in the proxy, browser hardening and encrypted credential store. Current admin token represents full administrative authority.
- Do not use with devices you do not own or administer.

## Development

```sh
npm ci
npm test
npm run server
```

Apache-2.0. Contributions welcome.
