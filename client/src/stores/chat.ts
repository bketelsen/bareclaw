import { create } from 'zustand';

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
}

let nextId = 0;

export const useChatStore = create<ChatState>((set) => ({
  messages: {},
  streamingId: {},

  addUserMessage: (channel, text) =>
    set((state) => {
      const id = `msg-${++nextId}`;
      const msg: ChatMessage = { id, role: 'user', text, timestamp: Date.now() };
      const channelMsgs = [...(state.messages[channel] || []), msg];
      return { messages: { ...state.messages, [channel]: channelMsgs } };
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
      return {
        messages: {
          ...state.messages,
          [channel]: msgs.map((m) =>
            m.id === messageId
              ? { ...m, text, isStreaming: false, toolActivity: undefined, durationMs }
              : m,
          ),
        },
        streamingId: { ...state.streamingId, [channel]: null },
      };
    }),
}));
