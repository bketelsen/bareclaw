import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Auth } from './auth.js';

const TEST_DIR = '/tmp/bareclaw-auth-test';

function makeAuth(overrides: { allowRegistration?: string; jwtSecret?: string } = {}) {
  return new Auth({
    runtimeDir: TEST_DIR,
    jwtSecret: overrides.jwtSecret,
    allowRegistration: overrides.allowRegistration,
  });
}

describe('Auth', () => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('register', () => {
    it('creates first user without auth', async () => {
      const auth = makeAuth();
      const result = await auth.register('alice', 'password123');
      expect(result.ok).toBe(true);
      expect(result.token).toBeDefined();
    });

    it('rejects second registration without token when allowRegistration is unset', async () => {
      const auth = makeAuth();
      await auth.register('alice', 'password123');
      const result = await auth.register('bob', 'password123');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('auth');
    });

    it('allows second registration with valid token', async () => {
      const auth = makeAuth();
      const first = await auth.register('alice', 'password123');
      const result = await auth.register('bob', 'password123', first.token);
      expect(result.ok).toBe(true);
    });

    it('allows open registration when allowRegistration=true', async () => {
      const auth = makeAuth({ allowRegistration: 'true' });
      await auth.register('alice', 'password123');
      const result = await auth.register('bob', 'password123');
      expect(result.ok).toBe(true);
    });

    it('blocks all registration when allowRegistration=false', async () => {
      const auth = makeAuth({ allowRegistration: 'false' });
      const result = await auth.register('alice', 'password123');
      expect(result.ok).toBe(false);
    });

    it('rejects duplicate usernames', async () => {
      const auth = makeAuth();
      const first = await auth.register('alice', 'password123');
      const result = await auth.register('alice', 'other', first.token);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('exists');
    });

    it('persists users to disk', async () => {
      const auth = makeAuth();
      await auth.register('alice', 'password123');
      const file = readFileSync(join(TEST_DIR, 'users.json'), 'utf-8');
      const users = JSON.parse(file);
      expect(users).toHaveLength(1);
      expect(users[0].username).toBe('alice');
      expect(users[0].passwordHash).not.toBe('password123');
    });
  });

  describe('login', () => {
    it('returns token for valid credentials', async () => {
      const auth = makeAuth();
      await auth.register('alice', 'password123');
      const result = await auth.login('alice', 'password123');
      expect(result.ok).toBe(true);
      expect(result.token).toBeDefined();
    });

    it('rejects wrong password', async () => {
      const auth = makeAuth();
      await auth.register('alice', 'password123');
      const result = await auth.login('alice', 'wrong');
      expect(result.ok).toBe(false);
    });

    it('rejects unknown username', async () => {
      const auth = makeAuth();
      const result = await auth.login('nobody', 'password123');
      expect(result.ok).toBe(false);
    });
  });

  describe('verifyToken', () => {
    it('returns username for valid token', async () => {
      const auth = makeAuth();
      const reg = await auth.register('alice', 'password123');
      const payload = auth.verifyToken(reg.token!);
      expect(payload).toBeDefined();
      expect(payload!.username).toBe('alice');
    });

    it('returns null for invalid token', () => {
      const auth = makeAuth();
      expect(auth.verifyToken('garbage')).toBeNull();
    });
  });

  describe('JWT secret persistence', () => {
    it('auto-generates and persists secret when not provided', () => {
      const auth1 = makeAuth();
      const auth2 = makeAuth();
      // Both should load the same persisted secret
      const secretFile = join(TEST_DIR, 'jwt-secret');
      expect(existsSync(secretFile)).toBe(true);
    });

    it('uses provided secret instead of generating', () => {
      const auth = makeAuth({ jwtSecret: 'my-secret' });
      const secretFile = join(TEST_DIR, 'jwt-secret');
      // Should not write file when secret is provided via env
      expect(existsSync(secretFile)).toBe(false);
    });
  });
});
