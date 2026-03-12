# Shared Memory Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cross-session shared memory so all BAREclaw channels share user identity, preferences, and other durable facts.

**Architecture:** Memory is stored as individual `.md` files in `${config.runtimeDir}/memory/`. Every incoming message gets shared memory prepended via `prependContext()`. Three HTTP endpoints (`GET/POST/DELETE /memory`) let agents read and write memory entries. SOUL.md instructs the agent when to write.

**Tech Stack:** TypeScript, Express, Node.js `fs` (synchronous), Vitest

**Spec:** `docs/superpowers/specs/2026-03-12-shared-memory-design.md`

---

## Chunk 1: Memory reading in prependContext()

### Task 1: Add a helper to load shared memory from disk

**Files:**
- Modify: `src/core/process-manager.ts:1-7` (imports), `src/core/process-manager.ts:292-303` (prependContext)

- [ ] **Step 1: Write the failing test for loadSharedMemory**

Create `src/core/process-manager.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, chmodSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { ProcessManager } from './process-manager.js';
import type { Config } from '../config.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 3000,
    host: '127.0.0.1',
    runtimeDir: resolve(tmpdir(), `bareclaw-test-${Date.now()}`),
    cwd: '/tmp',
    maxTurns: 25,
    allowedTools: 'Read,Bash',
    timeoutMs: 0,
    httpToken: undefined,
    telegramToken: undefined,
    allowedUsers: [],
    sessionFile: '.bareclaw-sessions.json',
    jwtSecret: undefined,
    allowRegistration: undefined,
    ...overrides,
  };
}

describe('ProcessManager.prependContext with shared memory', () => {
  let config: Config;
  let memoryDir: string;

  beforeEach(() => {
    config = makeConfig();
    memoryDir = resolve(config.runtimeDir, 'memory');
    mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(config.runtimeDir, { recursive: true, force: true });
  });

  it('prepends shared memory to string content', () => {
    writeFileSync(resolve(memoryDir, 'identity.md'), 'Name is bjk.');
    const pm = new ProcessManager(config);
    // Access private method via type assertion for testing
    const result = (pm as any).prependContext('hello', { channel: 'test', adapter: 'http' });
    expect(typeof result).toBe('string');
    expect(result).toContain('## Shared Memory');
    expect(result).toContain('### identity');
    expect(result).toContain('Name is bjk.');
    expect(result).toContain('[channel: test, adapter: http]');
    expect(result).toContain('hello');
  });

  it('prepends shared memory to ContentBlock[] content', () => {
    writeFileSync(resolve(memoryDir, 'identity.md'), 'Name is bjk.');
    const pm = new ProcessManager(config);
    const blocks = [{ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png', data: 'abc' } }];
    const result = (pm as any).prependContext(blocks, { channel: 'test', adapter: 'http' });
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].type).toBe('text');
    expect(result[0].text).toContain('## Shared Memory');
    expect(result[0].text).toContain('Name is bjk.');
  });

  it('works when memory directory does not exist', () => {
    rmSync(memoryDir, { recursive: true, force: true });
    const pm = new ProcessManager(config);
    const result = (pm as any).prependContext('hello', { channel: 'test', adapter: 'http' });
    expect(typeof result).toBe('string');
    expect(result).toContain('[channel: test, adapter: http]');
    expect(result).toContain('hello');
    expect(result).not.toContain('## Shared Memory');
  });

  it('works when memory directory is empty', () => {
    // memoryDir exists but has no files
    const pm = new ProcessManager(config);
    const result = (pm as any).prependContext('hello', { channel: 'test', adapter: 'http' });
    expect(result).not.toContain('## Shared Memory');
  });

  it('reads multiple memory files', () => {
    writeFileSync(resolve(memoryDir, 'identity.md'), 'Name is bjk.');
    writeFileSync(resolve(memoryDir, 'preferences.md'), 'Prefers concise responses.');
    const pm = new ProcessManager(config);
    const result = (pm as any).prependContext('hello', { channel: 'test', adapter: 'http' });
    expect(result).toContain('### identity');
    expect(result).toContain('### preferences');
    expect(result).toContain('Name is bjk.');
    expect(result).toContain('Prefers concise responses.');
  });

  it('ignores non-.md files in memory directory', () => {
    writeFileSync(resolve(memoryDir, 'identity.md'), 'Name is bjk.');
    writeFileSync(resolve(memoryDir, 'notes.txt'), 'Should be ignored.');
    const pm = new ProcessManager(config);
    const result = (pm as any).prependContext('hello', { channel: 'test', adapter: 'http' });
    expect(result).toContain('### identity');
    expect(result).not.toContain('Should be ignored');
  });

  it('gracefully handles unreadable memory files', () => {
    writeFileSync(resolve(memoryDir, 'identity.md'), 'Name is bjk.');
    writeFileSync(resolve(memoryDir, 'broken.md'), 'Unreadable.');
    chmodSync(resolve(memoryDir, 'broken.md'), 0o000);
    const pm = new ProcessManager(config);
    const result = (pm as any).prependContext('hello', { channel: 'test', adapter: 'http' });
    // Should not throw — message delivery must not be blocked
    expect(typeof result).toBe('string');
    expect(result).toContain('hello');
    // Restore permissions for cleanup
    chmodSync(resolve(memoryDir, 'broken.md'), 0o644);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/process-manager.test.ts`
Expected: Tests fail because `prependContext` doesn't read memory files yet.

- [ ] **Step 3: Implement loadSharedMemory and update prependContext**

In `src/core/process-manager.ts`, add `readdirSync` to the existing `fs` import on line 4:

```typescript
import { readFileSync, writeFileSync, unlinkSync, readdirSync } from 'fs';
```

Add a private method `loadSharedMemory()` to the `ProcessManager` class (after `saveSessions`, around line 285):

```typescript
  /**
   * Load all shared memory files from ${runtimeDir}/memory/*.md.
   * Returns a formatted string or empty string if no memory exists.
   * Never throws — a broken memory file must not prevent message delivery.
   */
  private loadSharedMemory(): string {
    try {
      const memDir = resolve(this.config.runtimeDir, 'memory');
      const files = readdirSync(memDir).filter(f => f.endsWith('.md')).sort();
      if (files.length === 0) return '';

      const sections = files.map(f => {
        const name = f.replace(/\.md$/, '');
        const content = readFileSync(resolve(memDir, f), 'utf-8').trim();
        return `### ${name}\n${content}`;
      });

      return `## Shared Memory\n${sections.join('\n\n')}`;
    } catch {
      return '';
    }
  }
```

Update `prependContext()` (line 292) to include shared memory in the prefix:

```typescript
  private prependContext(content: MessageContent, ctx: ChannelContext): MessageContent {
    const parts = [`channel: ${ctx.channel}`, `adapter: ${ctx.adapter}`];
    if (ctx.userName) parts.push(`user: ${ctx.userName}`);
    if (ctx.chatTitle) parts.push(`chat: ${ctx.chatTitle}`);
    if (ctx.topicName) parts.push(`topic: ${ctx.topicName}`);
    const channelPrefix = `[${parts.join(', ')}]`;

    const memory = this.loadSharedMemory();
    const prefix = memory ? `${channelPrefix}\n\n${memory}` : channelPrefix;

    if (typeof content === 'string') {
      return `${prefix}\n${content}`;
    }
    return [{ type: 'text' as const, text: prefix }, ...content];
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/process-manager.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `npx vitest run`
Expected: All existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/process-manager.ts src/core/process-manager.test.ts
git commit -m "feat: add shared memory reading to prependContext()"
```

---

## Chunk 2: Memory HTTP endpoints

### Task 2: Add GET /memory endpoint

**Files:**
- Modify: `src/adapters/http.ts:1-5` (imports), `src/adapters/http.ts:97-106` (before return router)
- Modify: `src/adapters/http.test.ts` (add memory test describe block)

- [ ] **Step 1: Write the failing test for GET /memory**

Add to `src/adapters/http.test.ts`. First, add the necessary imports at the top:

```typescript
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';
```

Update the `request` helper to support GET requests — add a `method` parameter:

```typescript
async function request(
  app: express.Express,
  path: string,
  body: unknown = null,
  headers: Record<string, string> = {},
  method: 'GET' | 'POST' | 'DELETE' = 'POST',
): Promise<{ status: number; body: unknown }> {
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const opts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    if (body !== null && method !== 'GET') {
      opts.body = JSON.stringify(body);
    }
    const resp = await fetch(`http://localhost:${port}${path}`, opts);
    const json = await resp.json();
    return { status: resp.status, body: json };
  } finally {
    server.close();
  }
}
```

Add the test block:

```typescript
describe('memory endpoints', () => {
  let memoryDir: string;
  let config: ReturnType<typeof makeConfig>;

  beforeEach(() => {
    const runtimeDir = resolve(tmpdir(), `bareclaw-mem-test-${Date.now()}`);
    memoryDir = resolve(runtimeDir, 'memory');
    mkdirSync(memoryDir, { recursive: true });
    config = makeConfig({ runtimeDir });
  });

  afterEach(() => {
    rmSync(config.runtimeDir, { recursive: true, force: true });
  });

  describe('GET /memory', () => {
    it('returns empty entries when no memory files exist', async () => {
      const app = buildApp(config, mockProcessManager(), mockPushRegistry());
      const res = await request(app, '/memory', null, {}, 'GET');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ entries: [] });
    });

    it('returns all memory entries', async () => {
      writeFileSync(resolve(memoryDir, 'identity.md'), 'Name is bjk.');
      writeFileSync(resolve(memoryDir, 'preferences.md'), 'Concise responses.');
      const app = buildApp(config, mockProcessManager(), mockPushRegistry());
      const res = await request(app, '/memory', null, {}, 'GET');
      expect(res.status).toBe(200);
      const body = res.body as { entries: { name: string; content: string }[] };
      expect(body.entries).toHaveLength(2);
      expect(body.entries.find(e => e.name === 'identity')?.content).toBe('Name is bjk.');
      expect(body.entries.find(e => e.name === 'preferences')?.content).toBe('Concise responses.');
    });

    it('ignores non-.md files', async () => {
      writeFileSync(resolve(memoryDir, 'identity.md'), 'Name is bjk.');
      writeFileSync(resolve(memoryDir, 'notes.txt'), 'Ignored.');
      const app = buildApp(config, mockProcessManager(), mockPushRegistry());
      const res = await request(app, '/memory', null, {}, 'GET');
      const body = res.body as { entries: { name: string }[] };
      expect(body.entries).toHaveLength(1);
      expect(body.entries[0].name).toBe('identity');
    });
  });
});
```

Note: also add `import { beforeEach, afterEach } from 'vitest';` to the existing import line.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/adapters/http.test.ts`
Expected: FAIL — GET /memory route doesn't exist yet.

- [ ] **Step 3: Implement GET /memory**

In `src/adapters/http.ts`, add fs imports at the top:

```typescript
import { readdirSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { resolve } from 'path';
```

Add the route before `return router;` (before line 105):

```typescript
  router.get('/memory', (_req, res) => {
    try {
      const memDir = resolve(config.runtimeDir, 'memory');
      let files: string[] = [];
      try {
        files = readdirSync(memDir).filter(f => f.endsWith('.md')).sort();
      } catch {}
      const entries = files.map(f => ({
        name: f.replace(/\.md$/, ''),
        content: readFileSync(resolve(memDir, f), 'utf-8'),
      }));
      res.json({ entries });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/adapters/http.test.ts`
Expected: New GET /memory tests PASS, all existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/http.ts src/adapters/http.test.ts
git commit -m "feat: add GET /memory endpoint"
```

### Task 3: Add POST /memory endpoint

**Files:**
- Modify: `src/adapters/http.ts` (add route)
- Modify: `src/adapters/http.test.ts` (add tests)

- [ ] **Step 1: Write the failing tests for POST /memory**

Add inside the `describe('memory endpoints')` block in `src/adapters/http.test.ts`:

```typescript
  describe('POST /memory', () => {
    it('creates a new memory entry', async () => {
      const app = buildApp(config, mockProcessManager(), mockPushRegistry());
      const res = await request(app, '/memory', { name: 'identity', content: 'Name is bjk.' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'saved', name: 'identity' });

      // Verify file was written
      const getRes = await request(app, '/memory', null, {}, 'GET');
      const body = getRes.body as { entries: { name: string; content: string }[] };
      expect(body.entries.find(e => e.name === 'identity')?.content).toBe('Name is bjk.');
    });

    it('overwrites an existing memory entry', async () => {
      writeFileSync(resolve(memoryDir, 'identity.md'), 'Old content.');
      const app = buildApp(config, mockProcessManager(), mockPushRegistry());
      const res = await request(app, '/memory', { name: 'identity', content: 'New content.' });
      expect(res.status).toBe(200);

      const getRes = await request(app, '/memory', null, {}, 'GET');
      const body = getRes.body as { entries: { name: string; content: string }[] };
      expect(body.entries.find(e => e.name === 'identity')?.content).toBe('New content.');
    });

    it('sanitizes name to prevent path traversal', async () => {
      const app = buildApp(config, mockProcessManager(), mockPushRegistry());
      const res = await request(app, '/memory', { name: '../../etc/passwd', content: 'evil' });
      expect(res.status).toBe(200);
      const body = res.body as { status: string; name: string };
      expect(body.name).not.toContain('/');
      expect(body.name).not.toContain('.');
    });

    it('returns 400 for missing name', async () => {
      const app = buildApp(config, mockProcessManager(), mockPushRegistry());
      const res = await request(app, '/memory', { content: 'hello' });
      expect(res.status).toBe(400);
    });

    it('returns 400 for missing content', async () => {
      const app = buildApp(config, mockProcessManager(), mockPushRegistry());
      const res = await request(app, '/memory', { name: 'identity' });
      expect(res.status).toBe(400);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/adapters/http.test.ts`
Expected: FAIL — POST /memory route doesn't exist yet.

- [ ] **Step 3: Implement POST /memory**

Add the route in `src/adapters/http.ts`, after the GET /memory route:

```typescript
  router.post('/memory', (req, res) => {
    const { name, content } = req.body as { name?: string; content?: string };

    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'Missing "name" field' });
      return;
    }
    if (content === undefined || content === null || typeof content !== 'string') {
      res.status(400).json({ error: 'Missing "content" field' });
      return;
    }

    const safeName = sanitizeChannel(name);
    const memDir = resolve(config.runtimeDir, 'memory');
    mkdirSync(memDir, { recursive: true });
    writeFileSync(resolve(memDir, `${safeName}.md`), content);
    console.log(`[http] memory saved: ${safeName}`);
    res.json({ status: 'saved', name: safeName });
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/adapters/http.test.ts`
Expected: All POST /memory tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/http.ts src/adapters/http.test.ts
git commit -m "feat: add POST /memory endpoint"
```

### Task 4: Add DELETE /memory endpoint

**Files:**
- Modify: `src/adapters/http.ts` (add route)
- Modify: `src/adapters/http.test.ts` (add tests)

- [ ] **Step 1: Write the failing tests for DELETE /memory**

Add inside the `describe('memory endpoints')` block in `src/adapters/http.test.ts`:

```typescript
  describe('DELETE /memory', () => {
    it('deletes an existing memory entry', async () => {
      writeFileSync(resolve(memoryDir, 'identity.md'), 'Name is bjk.');
      const app = buildApp(config, mockProcessManager(), mockPushRegistry());
      const res = await request(app, '/memory', { name: 'identity' }, {}, 'DELETE');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'deleted', name: 'identity' });

      // Verify file is gone
      const getRes = await request(app, '/memory', null, {}, 'GET');
      const body = getRes.body as { entries: unknown[] };
      expect(body.entries).toHaveLength(0);
    });

    it('returns success for nonexistent entry (idempotent)', async () => {
      const app = buildApp(config, mockProcessManager(), mockPushRegistry());
      const res = await request(app, '/memory', { name: 'doesnotexist' }, {}, 'DELETE');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'deleted', name: 'doesnotexist' });
    });

    it('sanitizes name to prevent path traversal', async () => {
      const app = buildApp(config, mockProcessManager(), mockPushRegistry());
      const res = await request(app, '/memory', { name: '../../etc/passwd' }, {}, 'DELETE');
      expect(res.status).toBe(200);
      const body = res.body as { name: string };
      expect(body.name).not.toContain('/');
    });

    it('returns 400 for missing name', async () => {
      const app = buildApp(config, mockProcessManager(), mockPushRegistry());
      const res = await request(app, '/memory', {}, {}, 'DELETE');
      expect(res.status).toBe(400);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/adapters/http.test.ts`
Expected: FAIL — DELETE /memory route doesn't exist yet.

- [ ] **Step 3: Implement DELETE /memory**

Add the route in `src/adapters/http.ts`, after the POST /memory route:

```typescript
  router.delete('/memory', (req, res) => {
    const { name } = req.body as { name?: string };

    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'Missing "name" field' });
      return;
    }

    const safeName = sanitizeChannel(name);
    const memDir = resolve(config.runtimeDir, 'memory');
    try {
      unlinkSync(resolve(memDir, `${safeName}.md`));
    } catch {}
    console.log(`[http] memory deleted: ${safeName}`);
    res.json({ status: 'deleted', name: safeName });
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/adapters/http.test.ts`
Expected: All DELETE /memory tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/http.ts src/adapters/http.test.ts
git commit -m "feat: add DELETE /memory endpoint"
```

---

## Chunk 3: SOUL.md instructions and full integration

### Task 5: Add shared memory instructions to SOUL.md

**Files:**
- Modify: `SOUL.md:46-48` (after the Personal section header)

- [ ] **Step 1: Add shared memory section to SOUL.md**

Add the following section to `SOUL.md` after the `## Personal` section (at the end of the file):

```markdown
## Shared memory

You have shared memory that persists across all channels. It's prepended to every message you receive — you don't need to fetch it.

To write shared memory, curl the local endpoint:
```bash
curl -s -X POST localhost:3000/memory \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $BARECLAW_HTTP_TOKEN" \
  -d '{"name": "<topic>", "content": "<full content>"}'
```

To delete a memory entry:
```bash
curl -s -X DELETE localhost:3000/memory \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $BARECLAW_HTTP_TOKEN" \
  -d '{"name": "<topic>"}'
```

**When to write:**
- User explicitly asks you to remember something
- User corrects identity or preference info (name, timezone, communication style)
- You learn something that contradicts what's in shared memory

**Never write:**
- Conversational details or debugging context
- Ephemeral task state
- Anything specific to a single channel or session

Content is full overwrite — include everything that should be in that topic, not just the new part.
```

- [ ] **Step 2: Commit**

```bash
git add SOUL.md
git commit -m "docs: add shared memory instructions to SOUL.md"
```

### Task 6: Run full test suite and verify integration

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 2: Manual smoke test — write and read memory**

Start the server (if not running) and test the endpoints manually:

```bash
# Write a memory entry
curl -s -X POST localhost:3000/memory \
  -H 'Content-Type: application/json' \
  -d '{"name": "identity", "content": "Name is bjk. Software engineer in Rhode Island."}'

# List all memory
curl -s localhost:3000/memory | jq .

# Send a message and verify shared memory appears in context
curl -s -X POST localhost:3000/message \
  -H 'Content-Type: application/json' \
  -d '{"text": "What is my name?", "channel": "test-memory"}'

# Delete the test entry
curl -s -X DELETE localhost:3000/memory \
  -H 'Content-Type: application/json' \
  -d '{"name": "identity"}'
```

Expected: The agent should see shared memory in the prepended context and know the user's name.

- [ ] **Step 3: Final commit if any adjustments were needed**

```bash
git add -A
git commit -m "feat: shared memory across sessions"
```
