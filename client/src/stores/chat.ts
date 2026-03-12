import { create } from 'zustand';

const STORAGE_KEY = 'bareclaw-chat-messages';
const MAX_PERSISTED_PER_CHANNEL = 100;

export interface ToolActivity {
  name: string;
  input?: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  isStreaming?: boolean;
  toolActivity?: ToolActivity;
  durationMs?: number;
}

interface ChatState {
  /** Messages keyed by channel */
  messages: Record<string, ChatMessage[]>;
  /** Currently streaming message ID per channel */
  streamingId: Record<string, string | null>;

  addUserMessage: (channel: string, text: string) => void;
  startAssistantMessage: (channel: string) => string;
  appendText: (channel: string, messageId: string, text: string) => void;
  setToolActivity: (channel: string, messageId: string, activity: ToolActivity | undefined) => void;
  finalizeMessage: (channel: string, messageId: string, text: string, durationMs: number) => void;
  deleteChannel: (channel: string) => void;
}

function loadMessages(): Record<string, ChatMessage[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, ChatMessage[]>;
  } catch {
    return {};
  }
}

function saveMessages(messages: Record<string, ChatMessage[]>): void {
  try {
    const trimmed: Record<string, ChatMessage[]> = {};
    for (const [ch, msgs] of Object.entries(messages)) {
      // Only persist finalized messages (not streaming)
      const finalized = msgs.filter((m) => !m.isStreaming);
      if (finalized.length > 0) {
        trimmed[ch] = finalized.slice(-MAX_PERSISTED_PER_CHANNEL);
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

let nextId = Date.now();

export const useChatStore = create<ChatState>((set) => ({
  messages: loadMessages(),
  streamingId: {},

  addUserMessage: (channel, text) =>
    set((state) => {
      const id = `msg-${++nextId}`;
      const msg: ChatMessage = { id, role: 'user', text, timestamp: Date.now() };
      const channelMsgs = [...(state.messages[channel] || []), msg];
      const messages = { ...state.messages, [channel]: channelMsgs };
      saveMessages(messages);
      return { messages };
    }),

  startAssistantMessage: (channel) => {
    const id = `msg-${++nextId}`;
    set((state) => {
      const msg: ChatMessage = { id, role: 'assistant', text: '', timestamp: Date.now(), isStreaming: true };
      const channelMsgs = [...(state.messages[channel] || []), msg];
      return {
        messages: { ...state.messages, [channel]: channelMsgs },
        streamingId: { ...state.streamingId, [channel]: id },
      };
    });
    return id;
  },

  appendText: (channel, messageId, text) =>
    set((state) => {
      const msgs = state.messages[channel];
      if (!msgs) return state;
      return {
        messages: {
          ...state.messages,
          [channel]: msgs.map((m) =>
            m.id === messageId ? { ...m, text: m.text + text } : m,
          ),
        },
      };
    }),

  setToolActivity: (channel, messageId, activity) =>
    set((state) => {
      const msgs = state.messages[channel];
      if (!msgs) return state;
      return {
        messages: {
          ...state.messages,
          [channel]: msgs.map((m) =>
            m.id === messageId ? { ...m, toolActivity: activity } : m,
          ),
        },
      };
    }),

  finalizeMessage: (channel, messageId, text, durationMs) =>
    set((state) => {
      const msgs = state.messages[channel];
      if (!msgs) return state;
      const messages = {
        ...state.messages,
        [channel]: msgs.map((m) =>
          m.id === messageId
            ? { ...m, text, isStreaming: false, toolActivity: undefined, durationMs }
            : m,
        ),
      };
      saveMessages(messages);
      return {
        messages,
        streamingId: { ...state.streamingId, [channel]: null },
      };
    }),

  deleteChannel: (channel) =>
    set((state) => {
      const { [channel]: _, ...rest } = state.messages;
      const { [channel]: __, ...restStreaming } = state.streamingId;
      const messages = rest;
      saveMessages(messages);
      return { messages, streamingId: restStreaming };
    }),
}));
