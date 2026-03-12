import { create } from 'zustand';

export interface Channel {
  channel: string;
  title: string;
  userId: string;
  createdAt: string;
  lastMessageAt: string;
}

interface ChannelState {
  channels: Channel[];
  activeChannel: string | null;
  setChannels: (channels: Channel[]) => void;
  addChannel: (channel: Channel) => void;
  removeChannel: (channelId: string) => void;
  renameChannel: (channelId: string, title: string) => void;
  setActiveChannel: (channelId: string | null) => void;
}

export const useChannelStore = create<ChannelState>((set) => ({
  channels: [],
  activeChannel: null,

  setChannels: (channels) => set({ channels }),

  addChannel: (channel) =>
    set((state) => ({
      channels: [channel, ...state.channels],
      activeChannel: channel.channel,
    })),

  removeChannel: (channelId) =>
    set((state) => ({
      channels: state.channels.filter((c) => c.channel !== channelId),
      activeChannel: state.activeChannel === channelId ? null : state.activeChannel,
    })),

  renameChannel: (channelId, title) =>
    set((state) => ({
      channels: state.channels.map((c) =>
        c.channel === channelId ? { ...c, title } : c,
      ),
    })),

  setActiveChannel: (channelId) => set({ activeChannel: channelId }),
}));
