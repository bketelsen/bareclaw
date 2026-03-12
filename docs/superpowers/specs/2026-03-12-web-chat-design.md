# Web Chat Interface Design

A self-hosted Claude web UI backed by BAREclaw's persistent session infrastructure.

## Requirements

- Self-hosted alternative to the Claude web UI
- User-managed channels: conversation list sidebar, create/switch/rename/delete
- Username/password authentication with JWT sessions
- Streaming responses with tool activity indicators (thinking, tool use, tool results)
- React + shadcn/ui + Tailwind + Vite frontend
- Power features: session inspector, server status, heartbeat monitor, cross-adapter messaging

## Architecture: WebSocket Adapter

A new `ws` adapter alongside the existing `http` and `telegram` adapters. Follows the same pattern: derive a channel key, build context, call `ProcessManager.send()`, stream events back.

The Express server serves the built React app as static files and upgrades `/ws` connections to WebSockets. Single port for everything.

### Backend Components

**WebSocket Adapter (`src/adapters/ws.ts`)**

Handles WebSocket connections on the `/ws` path. Auth occurs during the handshake via JWT query parameter. Each connection tracks userId and active channelId.

Client-to-server messages:

| Type | Payload | Purpose |
|------|---------|---------|
| `send` | `{channel, text, content?}` | Send message to Claude (`content` is `ContentBlock[]` for multimodal input) |
| `list-channels` | `{}` | Get user's conversations |
| `create-channel` | `{title?}` | Create new conversation |
| `delete-channel` | `{channel}` | Delete conversation |
| `rename-channel` | `{channel, title}` | Rename conversation |

Server-to-client messages:

| Type | Payload | Purpose |
|------|---------|---------|
| `event` | `{channel, event: ClaudeEvent}` | Streaming: text deltas, tool use, thinking |
| `result` | `{channel, text, duration_ms}` | Final response |
| `error` | `{channel?, message}` | Error |
| `channel-list` | `{channels: [...]}` | Response to list-channels |
| `channel-created` | `{channel, title}` | Confirms creation |
| `channel-deleted` | `{channel}` | Confirms deletion |

**Claude event forwarding:** The `ClaudeEvent` type (`src/core/types.ts`) is loosely typed — `type: string`, `subtype?: string`, plus optional fields like `message`, `result`, `session_id`. The WS adapter forwards raw `ClaudeEvent` objects to the frontend without transformation. The frontend maps events to UI state based on `type`/`subtype` fields discovered at runtime. During implementation, run a test session and log the actual NDJSON events from `claude -p` to catalog the event vocabulary. The frontend should handle unknown event types gracefully (ignore them).

**Push handler:** Registers with PushRegistry for `web-*` channel prefix. When a push arrives, delivers to all connected WebSocket clients subscribed to that channel. If no clients are connected, the push returns `false` (same as Telegram when the bot can't reach a chat) — the message is not queued.

**Auth (`src/auth.ts`)**

- Credential store: `~/.bareclaw/users.json` — array of `{username, passwordHash}`
- Password hashing: bcrypt
- `POST /auth/login` — validates credentials, returns JWT
- `POST /auth/register` — creates user. Registration is open when no users exist (bootstrapping). Once the first user is created, registration requires a valid JWT (existing user must be logged in). The `BARECLAW_ALLOW_REGISTRATION` env var overrides this: set to `true` to always allow open registration, `false` to disable registration entirely.
- JWT verified during WS handshake via query param
- Auth routes are mounted on the Express app *before* the HTTP adapter router, so they are not subject to the HTTP adapter's origin-blocking middleware.

**Conversation Metadata (`~/.bareclaw/conversations.json`)**

```json
{
  "web-bjk-daily-notes": {
    "title": "Daily Notes",
    "userId": "bjk",
    "createdAt": "2026-03-12T00:00:00Z",
    "lastMessageAt": "2026-03-12T12:00:00Z"
  }
}
```

Separate from `.bareclaw-sessions.json` — sessions track Claude process state, conversations track user-facing metadata. Written synchronously on every mutation (same pattern as `.bareclaw-sessions.json`). The `list-channels` WS message filters by the authenticated user's `userId` — users only see their own conversations.

**Channel naming:** `web-<userId>-<slug>` where slug is derived from the title or auto-generated.

### Frontend Components

**Stack:** React 19, shadcn/ui, Tailwind CSS, Vite, zustand for state management.

**Project structure:**

```
client/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── lib/
│   │   ├── ws.ts              # WebSocket client, reconnection, message types
│   │   └── auth.ts            # Login state, JWT storage
│   ├── hooks/
│   │   ├── useChat.ts         # Messages, streaming state per channel
│   │   └── useChannels.ts     # Channel list, CRUD operations
│   ├── components/
│   │   ├── Sidebar.tsx        # Conversation list + status footer
│   │   ├── ChatView.tsx       # Message list + input
│   │   ├── MessageBubble.tsx  # Single message with markdown/code rendering
│   │   ├── ToolActivity.tsx   # "Using Bash...", "Thinking..." indicators
│   │   ├── AdminPanel.tsx     # Server status, sessions, cross-adapter send
│   │   └── LoginPage.tsx      # Username/password form
│   └── styles/
│       └── globals.css        # Tailwind + custom theme
```

**Layout:** Claude-style fixed sidebar with conversation list and status footer. Main area is the chat view with header (channel name/info), scrolling message list, and input at the bottom.

**Message rendering:**
1. Streaming text deltas accumulate in zustand store
2. Each delta re-renders the current message bubble via `react-markdown` + `remark-gfm`
3. Tool activity events show/hide `ToolActivity` indicator inline
4. On `result`, finalize the message and stop streaming indicator

**Code rendering:** `react-syntax-highlighter` or `shiki` for syntax-highlighted code blocks within markdown.

**Admin panel** (accessible from sidebar):
- Active sessions list (channels, last activity, busy state)
- Server uptime, heartbeat status
- Cross-adapter send form (pick channel, type message)
- Restart button

### Integration

**Express changes (`src/index.ts`):**
- Serve `client/dist/` as static files via `express.static`
- Mount auth routes (`POST /auth/login`, `POST /auth/register`) *before* the HTTP adapter router so they bypass the origin-blocking middleware. The existing HTTP adapter's origin check and bearer token auth remain unchanged for `/message`, `/send`, `/restart`.
- WebSocket upgrade handling via the `ws` library on the same HTTP server

**WebSocket upgrade path:**
```
Browser → ws://host:port/ws?token=<jwt>
  → Express receives upgrade
  → Verify JWT
  → Hand off to ws adapter
  → Adapter manages connection lifecycle
```

**Reconnection:** Auto-reconnect with exponential backoff. On reconnect, re-authenticate and re-fetch channel list. In-flight streaming shows "reconnecting..." state.

**New server-side dependencies:**
- `ws` — WebSocket library
- `jsonwebtoken` — JWT signing/verification
- `bcrypt` — password hashing

**New env vars:**
- `BARECLAW_JWT_SECRET` — if not set, auto-generated on first run and persisted to `~/.bareclaw/jwt-secret` so tokens survive restarts
- `BARECLAW_ALLOW_REGISTRATION` — optional override. Set `true` to always allow open registration, `false` to disable entirely. If unset, registration is open when no users exist and closed otherwise.

**Build workflow** (all commands from root `package.json`, which orchestrates both server and client):
- `npm run dev` — BAREclaw server + Vite dev server with proxy config (`/ws`, `/auth/*` proxied to Express on port 3000)
- `npm run build:client` — installs client deps and builds frontend to `client/dist/`
- Production: serves pre-built static files, no Vite needed

### What Doesn't Change

- ProcessManager, SessionHost — untouched
- Telegram adapter — untouched
- Existing HTTP API (`/message`, `/send`, `/restart`) — still works as before
- Heartbeat — untouched
- Channel naming is already adapter-agnostic; `web-*` channels work with no core changes
