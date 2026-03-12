# Shared Memory Across Sessions

## Problem

BAREclaw sessions are per-channel and fully isolated. A user chatting on the web has no shared context with their Telegram session — not even their name. There's no mechanism for cross-session memory.

## Design

### Approach: Read-heavy, write-rare

Every session reads shared memory on every message. Writes are rare — triggered by explicit user requests, identity/preference corrections, or contradiction resolution.

### Storage

- Location: `~/.bareclaw/memory/`
- Format: one `.md` file per topic (e.g., `identity.md`, `preferences.md`)
- No index file. All files are globbed and loaded wholesale.
- Directory created on first write if it doesn't exist.

### Reading: prependContext()

`ProcessManager.prependContext()` is extended to:

1. Glob `~/.bareclaw/memory/*.md`
2. Read all files
3. Concatenate contents under a `## Shared Memory` header with each file as a subsection
4. Prepend to every incoming message alongside existing channel metadata

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
- `name` becomes the filename (`<name>.md`)
- `content` is the full file content (overwrite, not append)
- Creates file if it doesn't exist, replaces if it does

**`DELETE /memory`** — remove a memory entry
```json
// Request
{ "name": "identity" }
// Response
{ "status": "deleted", "name": "identity" }
```

**`GET /memory`** — list all memory entries
```json
// Response
{ "entries": [{ "name": "identity", "content": "Name is bjk. Software engineer." }] }
```

### Write triggers

Defined in SOUL.md. The agent writes memory by curling the local endpoint:
```bash
curl -s -X POST localhost:3000/memory \
  -H 'Content-Type: application/json' \
  -d '{"name": "identity", "content": "Name is bjk. Software engineer."}'
```

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

## Files to modify

- `src/core/process-manager.ts` — extend `prependContext()` to include shared memory
- `src/adapters/http.ts` — add `POST /memory`, `DELETE /memory`, `GET /memory` routes
- `SOUL.md` — add shared memory write instructions for the agent
