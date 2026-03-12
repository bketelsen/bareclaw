# Session Display Names

**Date:** 2026-03-12
**Status:** Draft

## Overview

Add persistent, editable display names to chat sessions in the web UI. Display names are cosmetic — they modify the conversation `title` field without affecting the underlying `channel` identifier.

## Features

### 1. Auto-title on first message

When the user sends their first message in a conversation that still has the default title ("New conversation"), the client auto-generates a title by truncating the message text to ~50 characters, breaking at a word boundary and appending "..." if truncated. This fires a `rename-channel` WebSocket message alongside the send.

**Trigger conditions (all must be true):**
- Active conversation title is "New conversation"
- Messages array for the channel is empty

This only fires once per conversation. If the user has already renamed, it's left alone.

**Logic location:** `ChatView.tsx` `handleSend()`

### 2. Inline editing in the chat header

The title in the `ChatView` header becomes click-to-edit. On click, it swaps to an `<input>` pre-filled with the current title. A small pencil icon appears on hover next to the title.

- **Enter** or **blur**: commits the change via `rename-channel`
- **Escape**: cancels, reverts to previous title

The channel ID secondary text remains read-only and unaffected.

### 3. Inline editing in the sidebar

Each conversation row in `Sidebar.tsx` gets a pencil icon on hover, alongside the existing delete "×" button. Clicking the pencil swaps the title text to an `<input>` with the same Enter/blur/Escape behavior as the header.

Both icons (pencil and delete) sit together on the right side of the row, visible on hover.

### 4. Shared `EditableTitle` component

A reusable component used in both the header and sidebar. Encapsulates:
- Display mode: text + pencil icon on hover
- Edit mode: input field, pre-filled with current title
- Commit on Enter/blur, cancel on Escape
- Props: `title`, `onRename`, and style/size variant for the two contexts

## Existing infrastructure used

- `rename-channel` WebSocket message (client → server) — already implemented
- `channel-renamed` WebSocket message (server → client) — already implemented
- `renameChannel` action in channel Zustand store — already implemented
- `conversations.rename(channel, title)` in `ConversationStore` — already implemented

No server-side changes required. This is purely a client-side feature leveraging existing plumbing.

## Data flow

1. User triggers rename (auto-title or manual edit)
2. Client sends `{ type: 'rename-channel', channel, title }` via WebSocket
3. Server updates `conversations.json` via `ConversationStore.rename()`
4. Server broadcasts `{ type: 'channel-renamed', channel, title }` back
5. Client channel store updates, UI reflects new title

## Files modified

- `client/src/components/ChatView.tsx` — auto-title logic in `handleSend()`, use `EditableTitle` in header
- `client/src/components/Sidebar.tsx` — use `EditableTitle` in conversation rows, add pencil icon alongside delete
- `client/src/components/EditableTitle.tsx` — new shared component
