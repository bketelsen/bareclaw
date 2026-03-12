import type { ToolActivity as ToolActivityType } from '../stores/chat';

interface ToolActivityProps {
  activity: ToolActivityType;
}

export function ToolActivity({ activity }: ToolActivityProps) {
  return (
    <div className="flex items-center gap-2 py-1 text-xs" style={{ color: 'var(--warning)' }}>
      <span className="animate-pulse">⚡</span>
      <span>Using {activity.name}...</span>
    </div>
  );
}
