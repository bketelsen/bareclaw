import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { sanitizeChannel } from '../config.js';

export interface Conversation {
  channel: string;
  title: string;
  userId: string;
  createdAt: string;
  lastMessageAt: string;
}

export class ConversationStore {
  private filePath: string;
  private conversations: Map<string, Conversation>;
  private counter: number;

  constructor(runtimeDir: string) {
    this.filePath = join(runtimeDir, 'conversations.json');
    this.conversations = this.load();
    this.counter = 0;
  }

  private load(): Map<string, Conversation> {
    try {
      const data = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Record<string, Conversation>;
      return new Map(Object.entries(data));
    } catch {
      return new Map();
    }
  }

  private save(): void {
    const obj: Record<string, Conversation> = {};
    for (const [ch, conv] of this.conversations) obj[ch] = conv;
    writeFileSync(this.filePath, JSON.stringify(obj, null, 2) + '\n');
  }

  create(userId: string, title?: string): Conversation {
    const displayTitle = title || 'New conversation';
    const slug = sanitizeChannel(displayTitle.toLowerCase().replace(/\s+/g, '-').substring(0, 40));
    const suffix = `${Date.now().toString(36)}${(this.counter++).toString(36)}`;
    const channel = `web-${sanitizeChannel(userId)}-${slug}-${suffix}`;
    const now = new Date().toISOString();

    const conv: Conversation = {
      channel,
      title: displayTitle,
      userId,
      createdAt: now,
      lastMessageAt: now,
    };

    this.conversations.set(channel, conv);
    this.save();
    return conv;
  }

  list(userId: string): Conversation[] {
    return [...this.conversations.values()]
      .filter(c => c.userId === userId)
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  }

  get(channel: string, userId: string): Conversation | null {
    const conv = this.conversations.get(channel);
    if (!conv || conv.userId !== userId) return null;
    return conv;
  }

  rename(channel: string, title: string): boolean {
    const conv = this.conversations.get(channel);
    if (!conv) return false;
    conv.title = title;
    this.save();
    return true;
  }

  delete(channel: string): boolean {
    const existed = this.conversations.delete(channel);
    if (existed) this.save();
    return existed;
  }

  touch(channel: string): void {
    const conv = this.conversations.get(channel);
    if (conv) {
      // Ensure monotonically increasing timestamp even within the same millisecond
      const now = new Date().toISOString();
      conv.lastMessageAt = now > conv.lastMessageAt ? now : new Date(new Date(conv.lastMessageAt).getTime() + 1).toISOString();
      this.save();
    }
  }
}
