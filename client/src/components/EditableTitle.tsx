import { useState, useRef, useEffect } from 'react';
import { Pencil } from 'lucide-react';

interface EditableTitleProps {
  title: string;
  onRename: (newTitle: string) => void;
  className?: string;
  inputClassName?: string;
}

export function EditableTitle({ title, onRename, className = '', inputClassName = '' }: EditableTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  // Sync draft when title changes externally
  useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);

  function commit() {
    const trimmed = draft.trim().slice(0, 100);
    setEditing(false);
    if (trimmed && trimmed !== title) {
      onRename(trimmed);
    } else {
      setDraft(title);
    }
  }

  function cancel() {
    setDraft(title);
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      cancel();
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={inputClassName}
        style={{
          background: 'var(--bg-secondary)',
          borderColor: 'var(--border)',
          color: 'var(--text-primary)',
        }}
        value={draft}
        maxLength={100}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
      />
    );
  }

  return (
    <span
      className={`group/title inline-flex items-center gap-1 ${className}`}
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      style={{ cursor: 'text' }}
    >
      <span className="truncate">{title}</span>
      <Pencil
        size={12}
        className="shrink-0 opacity-0 group-hover/title:opacity-50"
        style={{ color: 'var(--text-secondary)' }}
      />
    </span>
  );
}
