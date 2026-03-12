export type ServerMessage =
  | { type: 'event'; channel: string; event: Record<string, unknown> }
  | { type: 'result'; channel: string; text: string; duration_ms: number }
  | { type: 'error'; channel?: string; message: string }
  | { type: 'channel-list'; channels: Array<{ channel: string; title: string; userId: string; createdAt: string; lastMessageAt: string }> }
  | { type: 'channel-created'; channel: string; title: string }
  | { type: 'channel-deleted'; channel: string }
  | { type: 'channel-renamed'; channel: string; title: string }
  | { type: 'push'; channel: string; text: string };

export type ClientMessage =
  | { type: 'send'; channel: string; text: string }
  | { type: 'list-channels' }
  | { type: 'create-channel'; title?: string }
  | { type: 'delete-channel'; channel: string }
  | { type: 'rename-channel'; channel: string; title: string };

type MessageHandler = (msg: ServerMessage) => void;
type StatusHandler = (status: 'connecting' | 'connected' | 'disconnected') => void;

export class WsClient {
  private ws: WebSocket | null = null;
  private token: string;
  private onMessage: MessageHandler;
  private onStatus: StatusHandler;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private shouldReconnect = true;

  constructor(token: string, onMessage: MessageHandler, onStatus: StatusHandler) {
    this.token = token;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
  }

  connect(): void {
    this.shouldReconnect = true;
    this.onStatus('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws?token=${this.token}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.onStatus('connected');
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        this.onMessage(msg);
      } catch {
        console.error('[ws] failed to parse message:', event.data);
      }
    };

    this.ws.onclose = () => {
      this.onStatus('disconnected');
      if (this.shouldReconnect) {
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      }
    };

    this.ws.onerror = (err) => {
      console.error('[ws] error:', err);
    };
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.ws?.close();
  }
}
