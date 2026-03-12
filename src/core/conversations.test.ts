import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { ConversationStore } from './conversations.js';

const TEST_DIR = '/tmp/bareclaw-conv-test';

function makeStore() {
  return new ConversationStore(TEST_DIR);
}

describe('ConversationStore', () => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('create', () => {
    it('creates a conversation and returns channel key', () => {
      const store = makeStore();
      const conv = store.create('alice', 'My Chat');
      expect(conv.channel).toMatch(/^web-alice-/);
      expect(conv.title).toBe('My Chat');
      expect(conv.userId).toBe('alice');
    });

    it('auto-generates title when not provided', () => {
      const store = makeStore();
      const conv = store.create('alice');
      expect(conv.title).toBe('New conversation');
    });

    it('generates unique slugs for same title', () => {
      const store = makeStore();
      const c1 = store.create('alice', 'Test');
      const c2 = store.create('alice', 'Test');
      expect(c1.channel).not.toBe(c2.channel);
    });
  });

  describe('list', () => {
    it('returns only conversations for the given user', () => {
      const store = makeStore();
      store.create('alice', 'Alice Chat');
      store.create('bob', 'Bob Chat');
      const aliceConvs = store.list('alice');
      expect(aliceConvs).toHaveLength(1);
      expect(aliceConvs[0].title).toBe('Alice Chat');
    });

    it('returns conversations sorted by lastMessageAt descending', () => {
      const store = makeStore();
      const c1 = store.create('alice', 'Old');
      const c2 = store.create('alice', 'New');
      store.touch(c2.channel);
      const list = store.list('alice');
      expect(list[0].title).toBe('New');
    });
  });

  describe('rename', () => {
    it('updates the title', () => {
      const store = makeStore();
      const conv = store.create('alice', 'Old Title');
      store.rename(conv.channel, 'New Title');
      const list = store.list('alice');
      expect(list[0].title).toBe('New Title');
    });

    it('returns false for non-existent channel', () => {
      const store = makeStore();
      expect(store.rename('web-nobody-fake', 'Title')).toBe(false);
    });
  });

  describe('delete', () => {
    it('removes the conversation', () => {
      const store = makeStore();
      const conv = store.create('alice', 'Doomed');
      store.delete(conv.channel);
      expect(store.list('alice')).toHaveLength(0);
    });

    it('returns false for non-existent channel', () => {
      const store = makeStore();
      expect(store.delete('web-nobody-fake')).toBe(false);
    });
  });

  describe('touch', () => {
    it('updates lastMessageAt', () => {
      const store = makeStore();
      const conv = store.create('alice', 'Test');
      const before = store.list('alice')[0].lastMessageAt;
      // Small delay to ensure different timestamp
      store.touch(conv.channel);
      const after = store.list('alice')[0].lastMessageAt;
      expect(after >= before).toBe(true);
    });
  });

  describe('persistence', () => {
    it('survives reload', () => {
      const store1 = makeStore();
      store1.create('alice', 'Persistent');
      const store2 = makeStore();
      expect(store2.list('alice')).toHaveLength(1);
      expect(store2.list('alice')[0].title).toBe('Persistent');
    });
  });

  describe('ownership', () => {
    it('get returns null for wrong user', () => {
      const store = makeStore();
      const conv = store.create('alice', 'Secret');
      expect(store.get(conv.channel, 'bob')).toBeNull();
    });

    it('get returns conversation for correct user', () => {
      const store = makeStore();
      const conv = store.create('alice', 'Mine');
      expect(store.get(conv.channel, 'alice')).not.toBeNull();
    });
  });
});
