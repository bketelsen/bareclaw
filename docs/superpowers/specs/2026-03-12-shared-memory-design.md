# Shared Memory Across Sessions

## Problem

BAREclaw sessions are per-channel and fully isolated. A user chatting on the web has no shared context with their Telegram session — not even their name. There's no mechanism for cross-session memory.

## Design

### Approach: Read-heavy, write-rare

Every session reads shared memory on every message. Writes are rare — triggered by explicit user requests, identity/preference corrections, or contradiction resolution.

### Storage

- Location: `${config.runtimeDir}/memory/` (defaults to `~/.bareclaw/memory/`)
- Format: one `.md` file per topic (e.g., `identity.md`, `preferences.md`)
- No index file. All files are globbed and loaded wholesale.
- Directory created on first write if it doesn't exist.

### Reading: prependContext()

`ProcessManager.prependContext()` is extended to:

1. Use synchronous fs operations (`readdirSync`, `readFileSync`) to keep the method synchronous
2. Read all `.md` files from the memory directory
3. Concatenate contents under a `## Shared Memory` header with each file as a subsection
4. Concatenate the shared memory text into the existing prefix string, not as a separate operation — this ensures it works correctly with both string content and `ContentBlock[]` messages
5. Wrap the memory-reading portion in a try/catch — on failure, log a warning and continue without shared memory. A broken memory file must never prevent message delivery.

This means:
- Every message gets fresh memory — no restart needed when memory changes
- A write from one session is visible to all others on the next message
- No changes to session spawning or system prompt injection
- Extra tokens per message, but memory should be small (a few hundred tokens)

Example prepended content:
```
## Shared Memory
### identity
Name is bjk. Software engineer.

### preferences
Prefers concise responses. No emojis.
```

### Writing: HTTP endpoints

Three new endpoints on the BAREclaw server, behind existing `BARECLAW_HTTP_TOKEN` auth:

**`POST /memory`** — create or update a memory entry
```json
// Request
{ "name": "identity", "content": "Name is bjk. Software engineer." }
// Response
{ "status": "saved", "name": "identity" }
```

- `name` is sanitized to `[a-zA-Z0-9_-]` characters only before use as a filename (reuse existing `sanitizeChannel()` from `config.ts`). This prevents path traversal attacks.
- `content` is the full file content (overwrite, not append)
- Creates file if it doesn't exist, replaces if it does

**`DELETE /memory`** — remove a memory entry
```json
// Request
{ "name": "identity" }
// Response
{ "status": "deleted", "name": "identity" }
```
- Deleting a nonexistent entry returns success (idempotent).

**`GET /memory`** — list all memory entries
```json
// Response
{ "entries": [{ "name": "identity", "content": "Name is bjk. Software engineer." }] }
```

These endpoints are for agent/API use only. The HTTP adapter's origin-blocking middleware prevents web client access, which is intentional.

### Write triggers

Defined in SOUL.md. The agent writes memory by curling the local endpoint:
```bash
curl -s -X POST localhost:3000/memory \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $BARECLAW_HTTP_TOKEN" \
  -d '{"name": "identity", "content": "Name is bjk. Software engineer."}'
```

Sessions inherit `BARECLAW_HTTP_TOKEN` from the environment. If the token is unset, auth is skipped.

Triggers for writing:
- User explicitly asks to remember something
- User corrects identity or preference info (name, preferences, "don't do that")
- Session learns something that contradicts existing shared memory

Never write:
- Conversational details or debugging context
- Ephemeral task state
- Anything specific to a single channel/session

### What's not included

- No conflict resolution beyond last-write-wins (fine for single user)
- No size limits (can add later if needed)
- No memory expiry/TTL
- No per-channel memory — intentionally global
- No read caching (can add if memory grows beyond ~20 files)

## Files to modify

- `src/core/process-manager.ts` — extend `prependContext()` to read `${config.runtimeDir}/memory/*.md` synchronously, concatenate into existing prefix, with try/catch error handling
- `src/adapters/http.ts` — add `POST /memory`, `DELETE /memory`, `GET /memory` routes using `config.runtimeDir` for the memory directory path, with filename sanitization and synchronous fs operations
- `SOUL.md` — add shared memory write instructions for the agent, including curl examples with auth header
- `src/adapters/http.test.ts` — tests for memory endpoints: sanitization, GET with empty directory, POST+GET round-trip, DELETE of nonexistent entry
- `src/core/process-manager.test.ts` — tests for `prependContext()` memory reading: empty/missing directory, unreadable file graceful degradation, correct formatting with string and ContentBlock[] messages
