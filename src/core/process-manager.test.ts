import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, chmodSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { ProcessManager } from './process-manager.js';
import type { Config } from '../config.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 3000,
    host: '127.0.0.1',
    runtimeDir: resolve(tmpdir(), `bareclaw-test-${Date.now()}`),
    cwd: '/tmp',
    maxTurns: 25,
    allowedTools: 'Read,Bash',
    timeoutMs: 0,
    httpToken: undefined,
    telegramToken: undefined,
    allowedUsers: [],
    sessionFile: '.bareclaw-sessions.json',
    jwtSecret: undefined,
    allowRegistration: undefined,
    ...overrides,
  };
}

describe('ProcessManager.prependContext with shared memory', () => {
  let config: Config;
  let memoryDir: string;

  beforeEach(() => {
    config = makeConfig();
    memoryDir = resolve(config.runtimeDir, 'memory');
    mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(config.runtimeDir, { recursive: true, force: true });
  });

  it('prepends shared memory to string content', () => {
    writeFileSync(resolve(memoryDir, 'identity.md'), 'Name is bjk.');
    const pm = new ProcessManager(config);
    const result = (pm as any).prependContext('hello', { channel: 'test', adapter: 'http' });
    expect(typeof result).toBe('string');
    expect(result).toContain('## Shared Memory');
    expect(result).toContain('### identity');
    expect(result).toContain('Name is bjk.');
    expect(result).toContain('[channel: test, adapter: http]');
    expect(result).toContain('hello');
  });

  it('prepends shared memory to ContentBlock[] content', () => {
    writeFileSync(resolve(memoryDir, 'identity.md'), 'Name is bjk.');
    const pm = new ProcessManager(config);
    const blocks = [{ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png', data: 'abc' } }];
    const result = (pm as any).prependContext(blocks, { channel: 'test', adapter: 'http' });
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].type).toBe('text');
    expect(result[0].text).toContain('## Shared Memory');
    expect(result[0].text).toContain('Name is bjk.');
  });

  it('works when memory directory does not exist', () => {
    rmSync(memoryDir, { recursive: true, force: true });
    const pm = new ProcessManager(config);
    const result = (pm as any).prependContext('hello', { channel: 'test', adapter: 'http' });
    expect(typeof result).toBe('string');
    expect(result).toContain('[channel: test, adapter: http]');
    expect(result).toContain('hello');
    expect(result).not.toContain('## Shared Memory');
  });

  it('works when memory directory is empty', () => {
    const pm = new ProcessManager(config);
    const result = (pm as any).prependContext('hello', { channel: 'test', adapter: 'http' });
    expect(result).not.toContain('## Shared Memory');
  });

  it('reads multiple memory files', () => {
    writeFileSync(resolve(memoryDir, 'identity.md'), 'Name is bjk.');
    writeFileSync(resolve(memoryDir, 'preferences.md'), 'Prefers concise responses.');
    const pm = new ProcessManager(config);
    const result = (pm as any).prependContext('hello', { channel: 'test', adapter: 'http' });
    expect(result).toContain('### identity');
    expect(result).toContain('### preferences');
    expect(result).toContain('Name is bjk.');
    expect(result).toContain('Prefers concise responses.');
  });

  it('ignores non-.md files in memory directory', () => {
    writeFileSync(resolve(memoryDir, 'identity.md'), 'Name is bjk.');
    writeFileSync(resolve(memoryDir, 'notes.txt'), 'Should be ignored.');
    const pm = new ProcessManager(config);
    const result = (pm as any).prependContext('hello', { channel: 'test', adapter: 'http' });
    expect(result).toContain('### identity');
    expect(result).not.toContain('Should be ignored');
  });

  it('gracefully handles unreadable memory files', () => {
    writeFileSync(resolve(memoryDir, 'identity.md'), 'Name is bjk.');
    writeFileSync(resolve(memoryDir, 'broken.md'), 'Unreadable.');
    chmodSync(resolve(memoryDir, 'broken.md'), 0o000);
    const pm = new ProcessManager(config);
    const result = (pm as any).prependContext('hello', { channel: 'test', adapter: 'http' });
    expect(typeof result).toBe('string');
    expect(result).toContain('hello');
    // The readable file should still be included
    expect(result).toContain('### identity');
    expect(result).toContain('Name is bjk.');
    chmodSync(resolve(memoryDir, 'broken.md'), 0o644);
  });
});
