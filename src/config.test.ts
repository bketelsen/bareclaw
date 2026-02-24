import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, sanitizeChannel } from './config.js';

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all BARECLAW_ env vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('BARECLAW_')) delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns sensible defaults', () => {
    const config = loadConfig();
    expect(config.port).toBe(3000);
    expect(config.host).toBe('127.0.0.1');
    expect(config.runtimeDir).toMatch(/\.bareclaw$/);
    expect(config.maxTurns).toBe(25);
    expect(config.timeoutMs).toBe(0);
    expect(config.httpToken).toBeUndefined();
    expect(config.telegramToken).toBeUndefined();
    expect(config.allowedUsers).toEqual([]);
    expect(config.sessionFile).toBe('.bareclaw-sessions.json');
    expect(config.allowedTools).toBe('Read,Glob,Grep,Bash,Write,Edit,Skill,Task');
  });

  it('reads host from env', () => {
    process.env.BARECLAW_HOST = '0.0.0.0';
    expect(loadConfig().host).toBe('0.0.0.0');
  });

  it('reads runtime dir from env', () => {
    process.env.BARECLAW_RUNTIME_DIR = '/tmp/bareclaw-test';
    expect(loadConfig().runtimeDir).toBe('/tmp/bareclaw-test');
  });

  it('reads port from env', () => {
    process.env.BARECLAW_PORT = '8080';
    expect(loadConfig().port).toBe(8080);
  });

  it('reads max turns from env', () => {
    process.env.BARECLAW_MAX_TURNS = '50';
    expect(loadConfig().maxTurns).toBe(50);
  });

  it('reads HTTP token from env', () => {
    process.env.BARECLAW_HTTP_TOKEN = 'secret123';
    expect(loadConfig().httpToken).toBe('secret123');
  });

  it('parses allowed users as comma-separated ints', () => {
    process.env.BARECLAW_ALLOWED_USERS = '123, 456, 789';
    expect(loadConfig().allowedUsers).toEqual([123, 456, 789]);
  });

  it('filters out non-numeric allowed users', () => {
    process.env.BARECLAW_ALLOWED_USERS = '123, abc, 456';
    expect(loadConfig().allowedUsers).toEqual([123, 456]);
  });

  it('handles empty allowed users', () => {
    process.env.BARECLAW_ALLOWED_USERS = '';
    expect(loadConfig().allowedUsers).toEqual([]);
  });

  it('expands ~ in cwd', () => {
    process.env.BARECLAW_CWD = '~/projects';
    const config = loadConfig();
    expect(config.cwd).not.toContain('~');
    expect(config.cwd).toMatch(/\/projects$/);
  });
});

describe('sanitizeChannel', () => {
  it('allows alphanumeric, dash, and underscore', () => {
    expect(sanitizeChannel('tg-12345')).toBe('tg-12345');
    expect(sanitizeChannel('http')).toBe('http');
    expect(sanitizeChannel('my_channel')).toBe('my_channel');
  });

  it('replaces path traversal characters', () => {
    expect(sanitizeChannel('../../etc/passwd')).toBe('______etc_passwd');
    expect(sanitizeChannel('../foo')).toBe('___foo');
  });

  it('replaces dots and slashes', () => {
    expect(sanitizeChannel('foo.bar/baz')).toBe('foo_bar_baz');
  });

  it('replaces shell metacharacters', () => {
    expect(sanitizeChannel('foo;rm -rf /')).toBe('foo_rm_-rf__');
    expect(sanitizeChannel('$(whoami)')).toBe('__whoami_');
  });

  it('truncates long channel names', () => {
    const long = 'a'.repeat(200);
    expect(sanitizeChannel(long).length).toBe(128);
  });
});
