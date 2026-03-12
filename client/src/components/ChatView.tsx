import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageBubble } from './MessageBubble';
import { useChatStore } from '../stores/chat';
import { useChannelStore } from '../stores/channels';
import type { WsClient } from '../lib/ws';

const EMPTY_MESSAGES: never[] = [];

interface ChatViewProps {
  wsClient: WsClient;
}

export function ChatView({ wsClient }: ChatViewProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeChannel = useChannelStore((s) => s.activeChannel);
  const channels = useChannelStore((s) => s.channels);
  const messages = useChatStore((s) => activeChannel ? s.messages[activeChannel] || EMPTY_MESSAGES : EMPTY_MESSAGES);
  const streamingId = useChatStore((s) => activeChannel ? s.streamingId[activeChannel] : null);

  const activeConv = channels.find((c) => c.channel === activeChannel);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleSend() {
    if (!input.trim() || !activeChannel || streamingId) return;
    useChatStore.getState().addUserMessage(activeChannel, input);
    wsClient.send({ type: 'send', channel: activeChannel, text: input });
    setInput('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (!activeChannel) {
    return (
      <div className="flex flex-1 items-center justify-center" style={{ color: 'var(--text-secondary)' }}>
        Select a conversation or create a new one
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
        <span className="font-medium">{activeConv?.title || activeChannel}</span>
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{activeChannel}</span>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </ScrollArea>

      {/* Input */}
      <div className="border-t p-4" style={{ borderColor: 'var(--border)' }}>
        <div className="flex gap-2">
          <textarea
            className="flex-1 resize-none rounded-lg border px-3 py-2 text-sm outline-none"
            style={{
              background: 'var(--bg-secondary)',
              borderColor: 'var(--border)',
              color: 'var(--text-primary)',
            }}
            placeholder="Type a message..."
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!!streamingId}
          />
          <Button onClick={handleSend} disabled={!input.trim() || !!streamingId}>
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
