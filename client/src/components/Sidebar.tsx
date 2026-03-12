import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useChannelStore } from '../stores/channels';
import type { WsClient } from '../lib/ws';
import { EditableTitle } from './EditableTitle';

interface SidebarProps {
  wsClient: WsClient;
  wsStatus: 'connecting' | 'connected' | 'disconnected';
  onLogout: () => void;
  onOpenAdmin: () => void;
}

export function Sidebar({ wsClient, wsStatus, onLogout, onOpenAdmin }: SidebarProps) {
  const channels = useChannelStore((s) => s.channels);
  const activeChannel = useChannelStore((s) => s.activeChannel);
  const setActiveChannel = useChannelStore((s) => s.setActiveChannel);

  function handleNewConversation() {
    wsClient.send({ type: 'create-channel' });
  }

  function handleDelete(e: React.MouseEvent, channel: string) {
    e.stopPropagation();
    wsClient.send({ type: 'delete-channel', channel });
  }

  const statusColor = wsStatus === 'connected' ? 'var(--success)' : wsStatus === 'connecting' ? 'var(--warning)' : 'var(--error)';

  return (
    <div className="flex w-60 flex-col border-r" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
      {/* Header */}
      <div className="flex items-center justify-between p-3">
        <span className="text-sm font-semibold">Conversations</span>
        <Button variant="ghost" size="sm" onClick={handleNewConversation}>+</Button>
      </div>

      <Separator style={{ background: 'var(--border)' }} />

      {/* Channel list */}
      <ScrollArea className="flex-1">
        {channels.map((conv) => (
          <button
            key={conv.channel}
            className="group flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors"
            style={{
              background: conv.channel === activeChannel ? 'var(--bg-tertiary)' : 'transparent',
              color: conv.channel === activeChannel ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
            onClick={() => setActiveChannel(conv.channel)}
          >
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
          </button>
        ))}
      </ScrollArea>

      {/* Footer */}
      <Separator style={{ background: 'var(--border)' }} />
      <div className="space-y-1 p-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
        <div className="flex items-center gap-1">
          <span style={{ color: statusColor }}>●</span>
          <span>Server: {wsStatus}</span>
        </div>
        <div className="flex gap-2">
          <button className="underline" onClick={onOpenAdmin}>Admin</button>
          <button className="underline" onClick={onLogout}>Logout</button>
        </div>
      </div>
    </div>
  );
}
