import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { createHttpAdapter } from './http.js';
import type { Config } from '../config.js';
import type { ProcessManager } from '../core/process-manager.js';
import type { PushRegistry } from '../core/push-registry.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 3000,
    host: '127.0.0.1',
    runtimeDir: '/tmp/bareclaw-test',
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

function mockProcessManager() {
  return {
    send: vi.fn().mockResolvedValue({ text: 'response', duration_ms: 100 }),
    shutdown: vi.fn(),
    shutdownHosts: vi.fn(),
  } as unknown as ProcessManager;
}

function mockPushRegistry() {
  return {
    send: vi.fn().mockResolvedValue(true),
    register: vi.fn(),
    prefixes: ['tg-'],
  } as unknown as PushRegistry;
}

/** Create an Express app with the HTTP adapter and make a request */
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

function buildApp(config: Config, pm: ProcessManager, pushRegistry: PushRegistry) {
  const app = express();
  app.use(express.json());
  app.use(createHttpAdapter(config, pm, vi.fn(), pushRegistry));
  return app;
}

describe('HTTP adapter', () => {
  describe('POST /message', () => {
    it('sends text to processManager and returns response', async () => {
      const pm = mockProcessManager();
      const app = buildApp(makeConfig(), pm, mockPushRegistry());

      const res = await request(app, '/message', { text: 'hello', channel: 'test' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ text: 'response', duration_ms: 100 });
      expect(pm.send).toHaveBeenCalledWith('test', 'hello', { channel: 'test', adapter: 'http' });
    });

    it('defaults channel to "http"', async () => {
      const pm = mockProcessManager();
      const app = buildApp(makeConfig(), pm, mockPushRegistry());

      await request(app, '/message', { text: 'hello' });
      expect(pm.send).toHaveBeenCalledWith('http', 'hello', { channel: 'http', adapter: 'http' });
    });

    it('returns 400 for missing text', async () => {
      const pm = mockProcessManager();
      const app = buildApp(makeConfig(), pm, mockPushRegistry());

      const res = await request(app, '/message', { channel: 'test' });
      expect(res.status).toBe(400);
    });

    it('returns 400 for empty text', async () => {
      const pm = mockProcessManager();
      const app = buildApp(makeConfig(), pm, mockPushRegistry());

      const res = await request(app, '/message', { text: '  ', channel: 'test' });
      expect(res.status).toBe(400);
    });

    it('accepts content blocks as alternative to text', async () => {
      const pm = mockProcessManager();
      const app = buildApp(makeConfig(), pm, mockPushRegistry());
      const content = [{ type: 'text', text: 'hello' }];

      const res = await request(app, '/message', { content, channel: 'test' });
      expect(res.status).toBe(200);
      expect(pm.send).toHaveBeenCalledWith('test', content, { channel: 'test', adapter: 'http' });
    });

    it('returns 500 when processManager throws', async () => {
      const pm = mockProcessManager();
      (pm.send as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
      const app = buildApp(makeConfig(), pm, mockPushRegistry());

      const res = await request(app, '/message', { text: 'hello' });
      expect(res.status).toBe(500);
      expect((res.body as { error: string }).error).toBe('boom');
    });
  });

  describe('POST /send', () => {
    it('pushes message via registry', async () => {
      const push = mockPushRegistry();
      const app = buildApp(makeConfig(), mockProcessManager(), push);

      const res = await request(app, '/send', { channel: 'tg-123', text: 'hi' });
      expect(res.status).toBe(200);
      expect(push.send).toHaveBeenCalledWith('tg-123', 'hi', undefined);
    });

    it('returns 400 for missing channel', async () => {
      const app = buildApp(makeConfig(), mockProcessManager(), mockPushRegistry());
      const res = await request(app, '/send', { text: 'hi' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when neither text nor media provided', async () => {
      const app = buildApp(makeConfig(), mockProcessManager(), mockPushRegistry());
      const res = await request(app, '/send', { channel: 'tg-123' });
      expect(res.status).toBe(400);
      expect((res.body as { error: string }).error).toContain('text');
    });

    it('sends media with text caption', async () => {
      const push = mockPushRegistry();
      const app = buildApp(makeConfig(), mockProcessManager(), push);

      const res = await request(app, '/send', {
        channel: 'tg-123',
        text: 'Here is the chart',
        media: { filePath: '/tmp/chart.png' },
      });
      expect(res.status).toBe(200);
      expect(push.send).toHaveBeenCalledWith('tg-123', 'Here is the chart', { filePath: '/tmp/chart.png' });
    });

    it('sends media without text', async () => {
      const push = mockPushRegistry();
      const app = buildApp(makeConfig(), mockProcessManager(), push);

      const res = await request(app, '/send', {
        channel: 'tg-123',
        media: { filePath: '/tmp/doc.pdf' },
      });
      expect(res.status).toBe(200);
      expect(push.send).toHaveBeenCalledWith('tg-123', '', { filePath: '/tmp/doc.pdf' });
    });

    it('returns 400 when media.filePath is missing', async () => {
      const app = buildApp(makeConfig(), mockProcessManager(), mockPushRegistry());
      const res = await request(app, '/send', {
        channel: 'tg-123',
        media: {},
      });
      expect(res.status).toBe(400);
      expect((res.body as { error: string }).error).toContain('filePath');
    });

    it('returns 404 when no handler matches', async () => {
      const push = mockPushRegistry();
      (push.send as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      const app = buildApp(makeConfig(), mockProcessManager(), push);

      const res = await request(app, '/send', { channel: 'unknown-123', text: 'hi' });
      expect(res.status).toBe(404);
    });
  });

  describe('CORS protection', () => {
    it('blocks requests with Origin header', async () => {
      const app = buildApp(makeConfig(), mockProcessManager(), mockPushRegistry());
      const res = await request(app, '/message', { text: 'hello' }, {
        Origin: 'https://evil.com',
      });
      expect(res.status).toBe(403);
    });

    it('allows requests without Origin header', async () => {
      const app = buildApp(makeConfig(), mockProcessManager(), mockPushRegistry());
      const res = await request(app, '/message', { text: 'hello' });
      expect(res.status).toBe(200);
    });
  });

  describe('channel sanitization', () => {
    it('sanitizes path traversal in channel name', async () => {
      const pm = mockProcessManager();
      const app = buildApp(makeConfig(), pm, mockPushRegistry());

      await request(app, '/message', { text: 'hello', channel: '../../etc/passwd' });
      // channel should be sanitized — no slashes or dots
      const callArgs = (pm.send as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[0]).not.toContain('/');
      expect(callArgs[0]).not.toContain('.');
    });

    it('sanitizes channel in /send endpoint', async () => {
      const push = mockPushRegistry();
      const app = buildApp(makeConfig(), mockProcessManager(), push);

      await request(app, '/send', { channel: 'tg-123', text: 'hi' });
      expect(push.send).toHaveBeenCalledWith('tg-123', 'hi', undefined);
    });
  });

  describe('auth middleware', () => {
    it('rejects requests without token when auth is enabled', async () => {
      const config = makeConfig({ httpToken: 'secret' });
      const app = buildApp(config, mockProcessManager(), mockPushRegistry());

      const res = await request(app, '/message', { text: 'hello' });
      expect(res.status).toBe(401);
    });

    it('accepts requests with correct token', async () => {
      const config = makeConfig({ httpToken: 'secret' });
      const app = buildApp(config, mockProcessManager(), mockPushRegistry());

      const res = await request(app, '/message', { text: 'hello' }, {
        Authorization: 'Bearer secret',
      });
      expect(res.status).toBe(200);
    });

    it('rejects requests with wrong token', async () => {
      const config = makeConfig({ httpToken: 'secret' });
      const app = buildApp(config, mockProcessManager(), mockPushRegistry());

      const res = await request(app, '/message', { text: 'hello' }, {
        Authorization: 'Bearer wrong',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('memory endpoints', () => {
    let memoryDir: string;
    let memConfig: ReturnType<typeof makeConfig>;

    beforeEach(() => {
      const runtimeDir = resolve(tmpdir(), `bareclaw-mem-test-${Date.now()}`);
      memoryDir = resolve(runtimeDir, 'memory');
      mkdirSync(memoryDir, { recursive: true });
      memConfig = makeConfig({ runtimeDir });
    });

    afterEach(() => {
      rmSync(memConfig.runtimeDir, { recursive: true, force: true });
    });

    describe('GET /memory', () => {
      it('returns empty entries when no memory files exist', async () => {
        const app = buildApp(memConfig, mockProcessManager(), mockPushRegistry());
        const res = await request(app, '/memory', null, {}, 'GET');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ entries: [] });
      });

      it('returns all memory entries', async () => {
        writeFileSync(resolve(memoryDir, 'identity.md'), 'Name is bjk.');
        writeFileSync(resolve(memoryDir, 'preferences.md'), 'Concise responses.');
        const app = buildApp(memConfig, mockProcessManager(), mockPushRegistry());
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
        const app = buildApp(memConfig, mockProcessManager(), mockPushRegistry());
        const res = await request(app, '/memory', null, {}, 'GET');
        const body = res.body as { entries: { name: string }[] };
        expect(body.entries).toHaveLength(1);
        expect(body.entries[0].name).toBe('identity');
      });
    });

    describe('POST /memory', () => {
      it('creates a new memory entry', async () => {
        const app = buildApp(memConfig, mockProcessManager(), mockPushRegistry());
        const res = await request(app, '/memory', { name: 'identity', content: 'Name is bjk.' });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'saved', name: 'identity' });

        const getRes = await request(app, '/memory', null, {}, 'GET');
        const body = getRes.body as { entries: { name: string; content: string }[] };
        expect(body.entries.find(e => e.name === 'identity')?.content).toBe('Name is bjk.');
      });

      it('overwrites an existing memory entry', async () => {
        writeFileSync(resolve(memoryDir, 'identity.md'), 'Old content.');
        const app = buildApp(memConfig, mockProcessManager(), mockPushRegistry());
        const res = await request(app, '/memory', { name: 'identity', content: 'New content.' });
        expect(res.status).toBe(200);

        const getRes = await request(app, '/memory', null, {}, 'GET');
        const body = getRes.body as { entries: { name: string; content: string }[] };
        expect(body.entries.find(e => e.name === 'identity')?.content).toBe('New content.');
      });

      it('sanitizes name to prevent path traversal', async () => {
        const app = buildApp(memConfig, mockProcessManager(), mockPushRegistry());
        const res = await request(app, '/memory', { name: '../../etc/passwd', content: 'evil' });
        expect(res.status).toBe(200);
        const body = res.body as { status: string; name: string };
        expect(body.name).not.toContain('/');
        expect(body.name).not.toContain('.');
      });

      it('returns 400 for missing name', async () => {
        const app = buildApp(memConfig, mockProcessManager(), mockPushRegistry());
        const res = await request(app, '/memory', { content: 'hello' });
        expect(res.status).toBe(400);
      });

      it('returns 400 for missing content', async () => {
        const app = buildApp(memConfig, mockProcessManager(), mockPushRegistry());
        const res = await request(app, '/memory', { name: 'identity' });
        expect(res.status).toBe(400);
      });
    });

    describe('DELETE /memory', () => {
      it('deletes an existing memory entry', async () => {
        writeFileSync(resolve(memoryDir, 'identity.md'), 'Name is bjk.');
        const app = buildApp(memConfig, mockProcessManager(), mockPushRegistry());
        const res = await request(app, '/memory', { name: 'identity' }, {}, 'DELETE');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'deleted', name: 'identity' });

        const getRes = await request(app, '/memory', null, {}, 'GET');
        const body = getRes.body as { entries: unknown[] };
        expect(body.entries).toHaveLength(0);
      });

      it('returns success for nonexistent entry (idempotent)', async () => {
        const app = buildApp(memConfig, mockProcessManager(), mockPushRegistry());
        const res = await request(app, '/memory', { name: 'doesnotexist' }, {}, 'DELETE');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'deleted', name: 'doesnotexist' });
      });

      it('sanitizes name to prevent path traversal', async () => {
        const app = buildApp(memConfig, mockProcessManager(), mockPushRegistry());
        const res = await request(app, '/memory', { name: '../../etc/passwd' }, {}, 'DELETE');
        expect(res.status).toBe(200);
        const body = res.body as { name: string };
        expect(body.name).not.toContain('/');
      });

      it('returns 400 for missing name', async () => {
        const app = buildApp(memConfig, mockProcessManager(), mockPushRegistry());
        const res = await request(app, '/memory', {}, {}, 'DELETE');
        expect(res.status).toBe(400);
      });
    });
  });
});
