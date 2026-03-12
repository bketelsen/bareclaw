import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'http';
import { WebSocket } from 'ws';
import express from 'express';
import { createWebSocketAdapter } from './ws.js';
import type { ProcessManager } from '../core/process-manager.js';
import type { PushRegistry } from '../core/push-registry.js';
import type { Auth, TokenPayload } from '../auth.js';
import type { ConversationStore, Conversation } from '../core/conversations.js';

function mockAuth() {
  return {
    verifyToken: vi.fn().mockReturnValue({ username: 'alice' } satisfies TokenPayload),
    userCount: 1,
  } as unknown as Auth;
}

function mockProcessManager() {
  return {
    send: vi.fn().mockResolvedValue({ text: 'response', duration_ms: 100 }),
    shutdown: vi.fn(),
    shutdownHosts: vi.fn(),
  } as unknown as ProcessManager;
}

function mockConversationStore() {
  const convs = new Map<string, Conversation>();
  return {
    create: vi.fn().mockImplementation((userId: string, title?: string) => {
      const conv: Conversation = {
        channel: `web-${userId}-test-${Date.now()}`,
        title: title || 'New conversation',
        userId,
        createdAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
      };
      convs.set(conv.channel, conv);
      return conv;
    }),
    list: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    rename: vi.fn().mockReturnValue(true),
    delete: vi.fn().mockReturnValue(true),
    touch: vi.fn(),
  } as unknown as ConversationStore;
}

function mockPushRegistry() {
  return {
    send: vi.fn().mockResolvedValue(true),
    register: vi.fn(),
    prefixes: ['tg-'],
  } as unknown as PushRegistry;
}

/** Start a test server and connect a WS client */
async function setup(overrides: { auth?: Auth; pm?: ProcessManager; convs?: ConversationStore; push?: PushRegistry } = {}) {
  const auth = overrides.auth || mockAuth();
  const pm = overrides.pm || mockProcessManager();
  const convs = overrides.convs || mockConversationStore();
  const push = overrides.push || mockPushRegistry();

  const app = express();
  const server = createServer(app);
  const { stop } = createWebSocketAdapter(server, auth, pm, convs, push);

  await new Promise<void>(resolve => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;

  function connect(token = 'valid-token'): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws?token=${token}`);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
  }

  function sendAndReceive(ws: WebSocket, msg: object): Promise<object> {
    return new Promise((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString())));
      ws.send(JSON.stringify(msg));
    });
  }

  return { server, auth, pm, convs, push, connect, sendAndReceive, stop, port };
}

async function cleanup(server: Server, stop: () => void) {
  stop();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

describe('WebSocket adapter', () => {
  describe('connection', () => {
    it('accepts connection with valid token', async () => {
      const ctx = await setup();
      const ws = await ctx.connect();
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
      await cleanup(ctx.server, ctx.stop);
    });

    it('rejects connection with invalid token', async () => {
      const auth = mockAuth();
      (auth.verifyToken as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const ctx = await setup({ auth });

      await expect(ctx.connect('bad-token')).rejects.toThrow();
      await cleanup(ctx.server, ctx.stop);
    });
  });

  describe('channel operations', () => {
    it('creates a channel', async () => {
      const ctx = await setup();
      const ws = await ctx.connect();

      const resp = await ctx.sendAndReceive(ws, { type: 'create-channel', title: 'My Chat' });
      expect(resp).toHaveProperty('type', 'channel-created');
      expect(ctx.convs.create).toHaveBeenCalledWith('alice', 'My Chat');

      ws.close();
      await cleanup(ctx.server, ctx.stop);
    });

    it('lists channels', async () => {
      const ctx = await setup();
      const ws = await ctx.connect();

      const resp = await ctx.sendAndReceive(ws, { type: 'list-channels' });
      expect(resp).toHaveProperty('type', 'channel-list');
      expect(ctx.convs.list).toHaveBeenCalledWith('alice');

      ws.close();
      await cleanup(ctx.server, ctx.stop);
    });

    it('deletes a channel', async () => {
      const ctx = await setup();
      const ws = await ctx.connect();

      const resp = await ctx.sendAndReceive(ws, { type: 'delete-channel', channel: 'web-alice-test' });
      expect(resp).toHaveProperty('type', 'channel-deleted');

      ws.close();
      await cleanup(ctx.server, ctx.stop);
    });

    it('renames a channel', async () => {
      const ctx = await setup();
      const ws = await ctx.connect();

      const resp = await ctx.sendAndReceive(ws, { type: 'rename-channel', channel: 'web-alice-test', title: 'New Name' });
      expect(resp).toHaveProperty('type', 'channel-renamed');

      ws.close();
      await cleanup(ctx.server, ctx.stop);
    });
  });

  describe('message sending', () => {
    it('forwards message to ProcessManager and returns result', async () => {
      const ctx = await setup();
      const ws = await ctx.connect();

      const messages: object[] = [];
      ws.on('message', (data) => messages.push(JSON.parse(data.toString())));

      ws.send(JSON.stringify({ type: 'send', channel: 'web-alice-test', text: 'hello' }));

      // Wait for result
      await new Promise(resolve => setTimeout(resolve, 100));

      const result = messages.find((m: any) => m.type === 'result');
      expect(result).toBeDefined();
      expect(ctx.pm.send).toHaveBeenCalled();
      expect(ctx.convs.touch).toHaveBeenCalledWith('web-alice-test');

      ws.close();
      await cleanup(ctx.server, ctx.stop);
    });

    it('rejects send to channel not owned by user', async () => {
      const convs = mockConversationStore();
      (convs.get as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const ctx = await setup({ convs });
      const ws = await ctx.connect();

      const resp = await ctx.sendAndReceive(ws, { type: 'send', channel: 'web-bob-secret', text: 'hello' });
      expect(resp).toHaveProperty('type', 'error');

      ws.close();
      await cleanup(ctx.server, ctx.stop);
    });
  });

  describe('push handler', () => {
    it('registers web- prefix with push registry', async () => {
      const ctx = await setup();
      expect(ctx.push.register).toHaveBeenCalledWith('web-', expect.any(Function));
      await cleanup(ctx.server, ctx.stop);
    });
  });
});
