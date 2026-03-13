# CLAUDE.md — VioletDen

## Project Overview

Self-hosted smart home dashboard (React + Express + nginx) for organizing web services, devices, and network infrastructure. Provides SSH/Telnet terminal access to network devices with encrypted credential storage. LAN-only — no Let's Encrypt or public internet features.

## Architecture

```
┌────────────────┐      ┌──────────────┐      ┌──────────────┐
│     nginx      │─────▶│   frontend   │      │   backend    │
│ :80 → :443     │      │  Vite :5173  │      │ Express :4000│
│ (envsubst tpl) │─────▶│              │─────▶│              │
└────────────────┘      └──────────────┘      │  SQLite DB   │
      │                      │                │  SSH/Telnet  │
      │ /api/, /ws/          │ WebSocket      │  WebSocket   │
      └──────────────────────┴───────────────▶│  Terminal    │
                                              └──────────────┘
```

Three Docker containers behind an nginx reverse proxy:
- **nginx** — TLS termination (auto-generated self-signed cert), HTTP→HTTPS redirect, `envsubst` template for configurable backend port. Config is `nginx.conf.template` processed by `entrypoint.sh`.
- **frontend** — React 19 SPA served by Vite 8 dev server. Internal only (`expose`, not `ports`).
- **backend** — Express 5 API with SQLite (better-sqlite3), ssh2, ws. Internal only (`expose`, not `ports`).

### Docker Volumes

| Volume | Mount | Purpose |
|--------|-------|---------|
| `certs` | `/certs` | SSL certificates (nginx auto-generates on first run, shared with backend) |
| `data` | `/data` | SQLite DB (`violetden.db`) + encryption key (`.violetden_secret`) |

### Port Configuration

All ports are configurable via `.env`: `HTTP_PORT`, `HTTPS_PORT`, `BACKEND_PORT`. Nginx uses `envsubst` to inject `BACKEND_PORT` into its config template at runtime. Frontend and backend are only accessible through nginx.

## Directory Structure

```
├── backend/
│   ├── db.js           # SQLite init, config helpers, AES-256-GCM encrypt/decrypt
│   ├── index.js        # Express API (auth, sections, SSH CRUD, certs, settings, WebSocket terminal)
│   ├── package.json
│   └── Dockerfile
├── frontend/
│   └── src/
│       ├── main.jsx         # React entry point
│       ├── App.jsx          # Main app: setup-status check → Onboarding or AuthWrapper+Dashboard
│       ├── App.css          # All styles (single CSS file, CSS custom properties)
│       ├── api.js           # Fetch wrapper: auto Bearer token, auto 401 redirect (skips for validate-token)
│       ├── AuthWrapper.jsx  # Login screen, token validation on mount via /api/validate-token
│       ├── Onboarding.jsx   # First-run wizard: mandatory creds + preset sections, calls /api/setup
│       ├── SSHPanel.jsx     # SSH/Telnet: saved servers, free connect, xterm.js terminal, saved commands, error boundary
│       ├── SettingsPanel.jsx # Settings overlay: credentials (with confirm), certs (self-signed only), data mgmt
│       ├── IconPicker.jsx   # Material Icons picker (portal-based dropdown)
│       └── index.css        # Base/reset styles
├── nginx/
│   ├── nginx.conf.template  # Reverse proxy config template (uses ${BACKEND_PORT} envsubst)
│   ├── entrypoint.sh        # Auto-generates self-signed cert + envsubst → nginx.conf
│   └── Dockerfile
├── docker-compose.yml
├── .env.example
└── .gitignore
```

## Key Patterns

### App Bootstrap Flow

1. `App` component calls `GET /api/setup-status` on mount
2. If `setup_complete: false` → render `Onboarding` (no auth required)
3. Onboarding collects username, password (with confirm), and sections → `POST /api/setup` (public, one-time endpoint)
4. If `setup_complete: true` → render `AuthWrapper` → `Dashboard`
5. `AuthWrapper` validates stored token via `GET /api/validate-token` on mount; clears stale tokens

### Authentication

- **Backend**: Bearer token sessions stored in an in-memory `Map`. Tokens are `crypto.randomBytes(32)`, 24h TTL. Rate limiting: 10 login attempts per IP per 15min.
- **Frontend**: `api.js` exports `setToken()`/`getToken()`/`api()`. Token stored in `sessionStorage`. All authenticated calls go through `api()` which auto-injects the Bearer header and auto-reloads on 401 (except for `/api/validate-token` calls).
- **Middleware**: `requireAuth` on all endpoints except `POST /api/login`, `GET /api/sections`, `GET /api/validate-token`, `GET /api/setup-status`, `POST /api/setup`.

### Data Storage

- SQLite via `better-sqlite3` with WAL mode. Tables:
  - `config` — key/value store (sections JSON, admin credentials)
  - `ssh_services` — saved servers (passwords AES-256-GCM encrypted)
  - `saved_commands` — per-server saved commands
- Encryption key auto-generated in `DATA_DIR/.violetden_secret` (mode 0600)
- Config helpers: `getConfig(key, fallback)`, `setConfig(key, value)`

### Frontend State

- No state management library — plain React `useState`/`useEffect`
- `App` checks setup status → shows Onboarding (before auth) or AuthWrapper+Dashboard
- Dashboard has view/edit modes with section and link drag-and-drop reordering
- SSHPanel manages terminal lifecycle: `activeTerminal` state with React `key` for auto-disconnect on server switch
- XTerminal wrapped in `TerminalErrorBoundary` (class component) to prevent xterm crashes from killing the UI

### Styling

- Single CSS file (`App.css`) with CSS custom properties for the violet/dark theme
- Prefix conventions: `--v100`–`--v900` for violet shades, `--bg-*` for backgrounds
- Glass morphism via `backdrop-filter: blur()` + semi-transparent backgrounds
- Material Icons loaded from Google CDN (class `material-icons`)
- IconPicker uses `createPortal` to render dropdown into `document.body` to escape `overflow: hidden`
- xterm.js CSS imported from `@xterm/xterm/css/xterm.css`; custom theme overrides in Terminal config

### API Convention

- All endpoints under `/api/`
- Public: `POST /api/login`, `GET /api/sections`, `GET /api/validate-token`, `GET /api/setup-status`, `POST /api/setup`
- Protected: everything else (Bearer token required)
- Request/response: JSON (`Content-Type: application/json`)
- Error shape: `{ error: "message" }` or `{ success: false, error: "message" }`
- Success shape: `{ success: true, ... }` or direct data
- WebSocket: `/ws/terminal?token=<token>` for interactive SSH sessions

## Development

```bash
# Backend (Terminal 1)
cd backend && npm install && node index.js

# Frontend (Terminal 2)
cd frontend && npm install && npm run dev
```

Vite proxies `/api` and `/ws` (with WebSocket upgrade) to `http://localhost:4000` (configured in `vite.config.js`).

### Docker

```bash
# Standard build
docker compose up --build

# If build hangs on "resolving provenance"
BUILDX_NO_DEFAULT_ATTESTATIONS=1 docker compose build && docker compose up
```

## Common Tasks

### Adding a new API endpoint

1. Add route in `backend/index.js`
2. Add `requireAuth` middleware if the endpoint needs authentication
3. If public, add the path to the exclusion list in `requireAuth`
4. Use `api()` from `frontend/src/api.js` to call it from the frontend

### Adding a new Settings tab

1. Create a new tab component in `frontend/src/SettingsPanel.jsx`
2. Add the tab button to the `settings-tabs` array
3. Add conditional render in `settings-body`

### Adding a new frontend panel/page

1. Create component in `frontend/src/`
2. Import and render in `App.jsx` (no router — all panels are inline or overlay)
3. Add styles to `App.css`

## Security Notes

- SSH passwords encrypted at rest with AES-256-GCM (never stored in plaintext)
- Admin credentials stored in SQLite `config` table (not env vars at runtime)
- Certificate generation uses `execFile` (no shell injection) for openssl
- Domain input sanitized (alphanumeric, dots, hyphens only) before cert generation
- CORS configurable via `CORS_ORIGINS` env var (comma-separated origins)
- Onboarding uses a one-time public endpoint (`/api/setup`); blocked once credentials exist in DB
- Token validation on mount catches stale sessions after backend restarts
- Let's Encrypt removed — app is LAN-only, uses auto-generated self-signed certs
