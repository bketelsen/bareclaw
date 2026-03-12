import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { ToolActivity } from './ToolActivity';
import type { ChatMessage } from '../stores/chat';

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <div className="mb-4">
      <div className="mb-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
        {isUser ? 'You' : 'Claude'}
      </div>
      <div
        className="inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm"
        style={{
          background: isUser ? 'var(--accent)' : 'var(--bg-tertiary)',
          border: isUser ? 'none' : '1px solid var(--border)',
          color: isUser ? 'var(--bg-primary)' : 'var(--text-primary)',
        }}
      >
        {message.toolActivity && <ToolActivity activity={message.toolActivity} />}
        {message.text && (
          <div className={`prose max-w-none prose-pre:p-0 ${isUser ? '' : 'prose-invert'}`}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '');
                  const code = String(children).replace(/\n$/, '');
                  if (match) {
                    return (
                      <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div">
                        {code}
                      </SyntaxHighlighter>
                    );
                  }
                  return <code className={className} {...props}>{children}</code>;
                },
              }}
            >
              {message.text}
            </ReactMarkdown>
          </div>
        )}
        {message.isStreaming && !message.text && !message.toolActivity && (
          <span className="animate-pulse" style={{ color: 'var(--text-secondary)' }}>Thinking...</span>
        )}
      </div>
      {message.durationMs && (
        <div className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
          {(message.durationMs / 1000).toFixed(1)}s
        </div>
      )}
    </div>
  );
}
