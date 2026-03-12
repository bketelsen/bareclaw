import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { Server } from 'http';
import type { IncomingMessage } from 'http';
import type { Auth, TokenPayload } from '../auth.js';
import type { ProcessManager, EventCallback } from '../core/process-manager.js';
import type { ConversationStore } from '../core/conversations.js';
import type { PushRegistry } from '../core/push-registry.js';
import type { ChannelContext, ClaudeEvent } from '../core/types.js';

interface ClientState {
  username: string;
  ws: WebSocket;
}

type ClientMessage =
  | { type: 'send'; channel: string; text?: string; content?: unknown[] }
  | { type: 'list-channels' }
  | { type: 'create-channel'; title?: string }
  | { type: 'delete-channel'; channel: string }
  | { type: 'rename-channel'; channel: string; title: string }
  | { type: 'admin-send'; channel: string; text: string }
  | { type: 'admin-restart' };

export function createWebSocketAdapter(
  server: Server,
  auth: Auth,
  processManager: ProcessManager,
  conversations: ConversationStore,
  pushRegistry: PushRegistry,
): { stop: () => void } {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<ClientState>();

  // Register push handler for web-* channels
  pushRegistry.register('web-', async (channel: string, text: string) => {
    let delivered = false;
    for (const client of clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        // Check if this client owns the channel
        const conv = conversations.get(channel, client.username);
        if (conv) {
          client.ws.send(JSON.stringify({ type: 'push', channel, text }));
          delivered = true;
        }
      }
    }
    return delivered;
  });

  server.on('upgrade', (request: IncomingMessage, socket, head) => {
    const url = new URL(request.url || '/', `http://${request.headers.host}`);
    if (url.pathname !== '/ws') return;

    const token = url.searchParams.get('token');
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const payload = auth.verifyToken(token);
    if (!payload) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, payload);
    });
  });

  wss.on('connection', (ws: WebSocket, _request: IncomingMessage, payload: TokenPayload) => {
    const client: ClientState = { username: payload.username, ws };
    clients.add(client);
    console.log(`[ws] connected: ${payload.username}`);

    ws.on('message', async (raw: RawData) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        return;
      }

      try {
        await handleMessage(client, msg);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[ws] error for ${client.username}: ${message}`);
        ws.send(JSON.stringify({ type: 'error', message }));
      }
    });

    ws.on('close', () => {
      clients.delete(client);
      console.log(`[ws] disconnected: ${payload.username}`);
    });
  });

  async function handleMessage(client: ClientState, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case 'list-channels': {
        const channels = conversations.list(client.username);
        client.ws.send(JSON.stringify({ type: 'channel-list', channels }));
        break;
      }

      case 'create-channel': {
        const conv = conversations.create(client.username, msg.title);
        client.ws.send(JSON.stringify({ type: 'channel-created', channel: conv.channel, title: conv.title }));
        break;
      }

      case 'delete-channel': {
        const conv = conversations.get(msg.channel, client.username);
        if (!conv) {
          client.ws.send(JSON.stringify({ type: 'error', channel: msg.channel, message: 'Channel not found or not owned by you' }));
          return;
        }
        conversations.delete(msg.channel);
        client.ws.send(JSON.stringify({ type: 'channel-deleted', channel: msg.channel }));
        break;
      }

      case 'rename-channel': {
        const conv = conversations.get(msg.channel, client.username);
        if (!conv) {
          client.ws.send(JSON.stringify({ type: 'error', channel: msg.channel, message: 'Channel not found or not owned by you' }));
          return;
        }
        conversations.rename(msg.channel, msg.title);
        client.ws.send(JSON.stringify({ type: 'channel-renamed', channel: msg.channel, title: msg.title }));
        break;
      }

      case 'admin-send': {
        const sent = await pushRegistry.send(msg.channel, msg.text);
        client.ws.send(JSON.stringify({ type: 'admin-result', success: sent, channel: msg.channel }));
        break;
      }

      case 'admin-restart': {
        client.ws.send(JSON.stringify({ type: 'admin-result', success: true, action: 'restart' }));
        break;
      }

      case 'send': {
        // Verify ownership
        const conv = conversations.get(msg.channel, client.username);
        if (!conv) {
          client.ws.send(JSON.stringify({ type: 'error', channel: msg.channel, message: 'Channel not found or not owned by you' }));
          return;
        }

        const content = msg.content && Array.isArray(msg.content) ? msg.content : msg.text;
        if (!content || (typeof content === 'string' && !content.trim())) {
          client.ws.send(JSON.stringify({ type: 'error', channel: msg.channel, message: 'Empty message' }));
          return;
        }

        const context: ChannelContext = {
          channel: msg.channel,
          adapter: 'web',
          userName: client.username,
        };

        const onEvent: EventCallback = (event: ClaudeEvent) => {
          if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify({ type: 'event', channel: msg.channel, event }));
          }
        };

        conversations.touch(msg.channel);
        const response = await processManager.send(msg.channel, content, context, onEvent);

        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify({
            type: 'result',
            channel: msg.channel,
            text: response.text,
            duration_ms: response.duration_ms,
          }));
        }
        break;
      }
    }
  }

  function stop() {
    for (const client of clients) {
      client.ws.close();
    }
    clients.clear();
    wss.close();
  }

  return { stop };
}
