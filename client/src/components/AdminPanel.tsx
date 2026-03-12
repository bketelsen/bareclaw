import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { WsClient } from '../lib/ws';

interface AdminPanelProps {
  open: boolean;
  onClose: () => void;
  wsClient: WsClient;
  wsStatus: 'connecting' | 'connected' | 'disconnected';
}

export function AdminPanel({ open, onClose, wsClient, wsStatus }: AdminPanelProps) {
  const [sendChannel, setSendChannel] = useState('');
  const [sendText, setSendText] = useState('');
  const [sendResult, setSendResult] = useState('');
  const [restarting, setRestarting] = useState(false);

  function handleSend() {
    setSendResult('');
    wsClient.send({ type: 'admin-send', channel: sendChannel, text: sendText } as any);
    setSendResult('Sent via WebSocket');
  }

  function handleRestart() {
    setRestarting(true);
    wsClient.send({ type: 'admin-restart' } as any);
    setSendResult('Restart initiated — server will reconnect shortly');
    setTimeout(() => setRestarting(false), 3000);
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
        <DialogHeader>
          <DialogTitle>Admin Panel</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Server status */}
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Server Status</h3>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              WebSocket: <span style={{ color: wsStatus === 'connected' ? 'var(--success)' : 'var(--error)' }}>{wsStatus}</span>
            </div>
          </div>

          {/* Cross-adapter send */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Send message (cross-adapter)</h3>
            <Input
              placeholder="Channel (e.g. tg-123456)"
              value={sendChannel}
              onChange={(e) => setSendChannel(e.target.value)}
            />
            <Input
              placeholder="Message text"
              value={sendText}
              onChange={(e) => setSendText(e.target.value)}
            />
            <Button size="sm" onClick={handleSend} disabled={!sendChannel || !sendText}>
              Send
            </Button>
          </div>

          {/* Restart */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Server</h3>
            <Button size="sm" variant="destructive" onClick={handleRestart} disabled={restarting}>
              {restarting ? 'Restarting...' : 'Restart Server'}
            </Button>
          </div>

          {/* Result */}
          {sendResult && (
            <pre className="rounded p-2 text-xs" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
              {sendResult}
            </pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
