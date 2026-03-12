# Session Display Names Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add editable display names to web chat sessions with auto-titling from the first message.

**Architecture:** A shared `EditableTitle` component handles inline click-to-edit with pencil icon, used in both the chat header and sidebar. Auto-title logic in `ChatView.handleSend()` generates a title from the first message text when the conversation still has the default name. All renaming flows through the existing `rename-channel` WebSocket message.

**Tech Stack:** React, Zustand, lucide-react (Pencil icon), existing WebSocket infrastructure

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `client/src/components/EditableTitle.tsx` | Create | Shared click-to-edit component with pencil icon |
| `client/src/components/ChatView.tsx` | Modify | Auto-title on first send, use EditableTitle in header |
| `client/src/components/Sidebar.tsx` | Modify | Use EditableTitle in conversation rows |

---

## Task 1: Create `EditableTitle` component

**Files:**
- Create: `client/src/components/EditableTitle.tsx`

- [ ] **Step 1: Create the component file**

```tsx
import { useState, useRef, useEffect } from 'react';
import { Pencil } from 'lucide-react';

interface EditableTitleProps {
  title: string;
  onRename: (newTitle: string) => void;
  className?: string;
  inputClassName?: string;
}

export function EditableTitle({ title, onRename, className = '', inputClassName = '' }: EditableTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  // Sync draft when title changes externally
  useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);

  function commit() {
    const trimmed = draft.trim().slice(0, 100);
    setEditing(false);
    if (trimmed && trimmed !== title) {
      onRename(trimmed);
    } else {
      setDraft(title);
    }
  }

  function cancel() {
    setDraft(title);
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      cancel();
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={inputClassName}
        style={{
          background: 'var(--bg-secondary)',
          borderColor: 'var(--border)',
          color: 'var(--text-primary)',
        }}
        value={draft}
        maxLength={100}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
      />
    );
  }

  return (
    <span
      className={`group/title inline-flex items-center gap-1 ${className}`}
      onClick={() => setEditing(true)}
      style={{ cursor: 'text' }}
    >
      <span className="truncate">{title}</span>
      <Pencil
        size={12}
        className="shrink-0 opacity-0 group-hover/title:opacity-50"
        style={{ color: 'var(--text-secondary)' }}
      />
    </span>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/bjk/projects/scratch/bareclaw/client && npx tsc --noEmit`
Expected: No errors related to EditableTitle

- [ ] **Step 3: Commit**

```bash
git add client/src/components/EditableTitle.tsx
git commit -m "feat: add EditableTitle component for inline rename"
```

---

## Task 2: Add auto-title and EditableTitle to ChatView header

**Files:**
- Modify: `client/src/components/ChatView.tsx`

- [ ] **Step 1: Add truncateTitle helper and update imports**

Add at the top of the file, after imports:

```tsx
import { EditableTitle } from './EditableTitle';
```

Add helper function before the component:

```tsx
function truncateTitle(text: string, max = 50): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const boundary = trimmed.lastIndexOf(' ', max);
  return (boundary > 0 ? trimmed.slice(0, boundary) : trimmed.slice(0, max)) + '...';
}
```

- [ ] **Step 2: Add auto-title logic to handleSend()**

In `handleSend()`, after `wsClient.send({ type: 'send', ... })` and before `setInput('')`, add:

```tsx
    // Auto-title: if conversation still has default name, generate from first message
    if (activeConv?.title === 'New conversation') {
      const autoTitle = truncateTitle(input);
      wsClient.send({ type: 'rename-channel', channel: activeChannel, title: autoTitle });
    }
```

- [ ] **Step 3: Replace header title span with EditableTitle**

Replace the header section:

```tsx
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
        <span className="font-medium">{activeConv?.title || activeChannel}</span>
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{activeChannel}</span>
      </div>
```

With:

```tsx
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
        <EditableTitle
          title={activeConv?.title || activeChannel}
          onRename={(title) => wsClient.send({ type: 'rename-channel', channel: activeChannel, title })}
          className="font-medium"
          inputClassName="rounded border px-2 py-1 text-sm font-medium outline-none"
        />
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{activeChannel}</span>
      </div>
```

- [ ] **Step 4: Verify it compiles**

Run: `cd /home/bjk/projects/scratch/bareclaw/client && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ChatView.tsx
git commit -m "feat: add auto-title and inline rename to chat header"
```

---

## Task 3: Add EditableTitle to Sidebar

**Files:**
- Modify: `client/src/components/Sidebar.tsx`
- Modify: `client/src/components/EditableTitle.tsx`

> **Note:** The spec says pencil and delete icons should sit together on the right. Instead, the pencil appears inline next to the title text (inside EditableTitle), which is more intuitive for a "click to edit" affordance. The delete button stays on the right. This is an intentional deviation.

- [ ] **Step 1: Add import**

```tsx
import { EditableTitle } from './EditableTitle';
```

- [ ] **Step 2: Add stopPropagation to EditableTitle**

In `client/src/components/EditableTitle.tsx`, the display `<span>` onClick must stop propagation so that clicking the title in a sidebar row doesn't also switch the active channel. Change:

```tsx
      onClick={() => setEditing(true)}
```

To:

```tsx
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
```

- [ ] **Step 3: Replace title display with EditableTitle in conversation rows**

In the channel list `button` element, replace:

```tsx
            <div className="min-w-0 flex-1">
              <div className="truncate">{conv.title}</div>
              <div className="truncate text-xs" style={{ color: 'var(--text-secondary)' }}>
                {new Date(conv.lastMessageAt).toLocaleDateString()}
              </div>
            </div>
            <span
              className="ml-2 hidden text-xs opacity-50 hover:opacity-100 group-hover:inline"
              onClick={(e) => handleDelete(e, conv.channel)}
            >
              ×
            </span>
```

With:

```tsx
            <div className="min-w-0 flex-1">
              <EditableTitle
                title={conv.title}
                onRename={(title) => {
                  wsClient.send({ type: 'rename-channel', channel: conv.channel, title });
                }}
                className="text-sm"
                inputClassName="w-full rounded border px-1 py-0.5 text-sm outline-none"
              />
              <div className="truncate text-xs" style={{ color: 'var(--text-secondary)' }}>
                {new Date(conv.lastMessageAt).toLocaleDateString()}
              </div>
            </div>
            <span
              className="ml-2 hidden text-xs opacity-50 hover:opacity-100 group-hover:inline"
              onClick={(e) => handleDelete(e, conv.channel)}
            >
              ×
            </span>
```

- [ ] **Step 4: Verify it compiles**

Run: `cd /home/bjk/projects/scratch/bareclaw/client && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add client/src/components/EditableTitle.tsx client/src/components/Sidebar.tsx
git commit -m "feat: add inline rename to sidebar conversation list"
```

---

## Task 4: Manual verification

- [ ] **Step 1: Build the client**

Run: `cd /home/bjk/projects/scratch/bareclaw/client && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 2: Deploy and test on running instance**

SSH to `debian@bareclaw` and test:
1. Create a new conversation — should show "New conversation"
2. Send a message — title should auto-update to truncated first message
3. Click pencil icon in chat header — should enter edit mode, Enter to save, Escape to cancel
4. Click pencil icon in sidebar row — same behavior, should not switch active channel
5. Try empty/whitespace title — should revert to previous title
6. Try very long title — should be capped at 100 chars

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -u
git commit -m "fix: address issues found during manual testing"
```
