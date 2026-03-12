import { useState, useEffect, useCallback, useRef } from 'react';
import { LoginPage } from './components/LoginPage';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { AdminPanel } from './components/AdminPanel';
import { WsClient, type ServerMessage } from './lib/ws';
import { getToken, clearToken } from './lib/auth';
import { useChannelStore } from './stores/channels';
import { useChatStore } from './stores/chat';

export function App() {
  const [authenticated, setAuthenticated] = useState(!!getToken());
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [adminOpen, setAdminOpen] = useState(false);
  const wsRef = useRef<WsClient | null>(null);

  // Track which channel has a streaming assistant message in progress
  const streamingMsgRef = useRef<Record<string, string>>({});

  const handleMessage = useCallback((msg: ServerMessage) => {
    const chatStore = useChatStore.getState();
    const channelStore = useChannelStore.getState();

    switch (msg.type) {
      case 'channel-list':
        channelStore.setChannels(msg.channels);
        break;

      case 'channel-created':
        channelStore.addChannel({
          channel: msg.channel,
          title: msg.title,
          userId: '',
          createdAt: new Date().toISOString(),
          lastMessageAt: new Date().toISOString(),
        });
        break;

      case 'channel-deleted':
        channelStore.removeChannel(msg.channel);
        break;

      case 'channel-renamed':
        channelStore.renameChannel(msg.channel, msg.title);
        break;

      case 'event': {
        const event = msg.event;
        let msgId = streamingMsgRef.current[msg.channel];

        // Start assistant message if not yet started
        if (!msgId) {
          msgId = chatStore.startAssistantMessage(msg.channel);
          streamingMsgRef.current[msg.channel] = msgId;
        }

        // Map Claude events to UI state
        const message = event.message as { content?: Array<Record<string, unknown>> } | undefined;
        if (event.type === 'assistant' && event.subtype === 'text') {
          // Text delta — append
          const content = message?.content;
          if (content && Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text' && typeof block.text === 'string') {
                chatStore.appendText(msg.channel, msgId, block.text);
              }
            }
          }
        } else if (event.type === 'assistant' && event.subtype === 'tool_use') {
          const content = message?.content;
          if (content && Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'tool_use' && typeof block.name === 'string') {
                chatStore.setToolActivity(msg.channel, msgId, { name: block.name });
              }
            }
          }
        } else if (event.type === 'assistant' && event.subtype === 'tool_result') {
          chatStore.setToolActivity(msg.channel, msgId, undefined);
        }
        break;
      }

      case 'result': {
        const msgId = streamingMsgRef.current[msg.channel];
        if (msgId) {
          chatStore.finalizeMessage(msg.channel, msgId, msg.text, msg.duration_ms);
          delete streamingMsgRef.current[msg.channel];
        }
        break;
      }

      case 'error':
        console.error('[app] server error:', msg.message);
        break;
    }
  }, []);

  useEffect(() => {
    if (!authenticated) return;

    const token = getToken();
    if (!token) return;

    const ws = new WsClient(token, handleMessage, setWsStatus);
    ws.connect();
    wsRef.current = ws;

    return () => {
      ws.disconnect();
      wsRef.current = null;
    };
  }, [authenticated, handleMessage]);

  // Request channel list when status changes to connected
  useEffect(() => {
    if (wsStatus === 'connected' && wsRef.current) {
      wsRef.current.send({ type: 'list-channels' });
    }
  }, [wsStatus]);

  function handleLogout() {
    clearToken();
    wsRef.current?.disconnect();
    setAuthenticated(false);
  }

  if (!authenticated) {
    return <LoginPage onLogin={() => setAuthenticated(true)} />;
  }

  if (!wsRef.current) {
    return <div className="flex h-screen items-center justify-center" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>Connecting...</div>;
  }

  return (
    <div className="flex h-screen" style={{ background: 'var(--bg-primary)' }}>
      <Sidebar
        wsClient={wsRef.current}
        wsStatus={wsStatus}
        onLogout={handleLogout}
        onOpenAdmin={() => setAdminOpen(true)}
      />
      <ChatView wsClient={wsRef.current} />
      <AdminPanel open={adminOpen} onClose={() => setAdminOpen(false)} wsClient={wsRef.current} wsStatus={wsStatus} />
    </div>
  );
}
