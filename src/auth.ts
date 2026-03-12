import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { ensureRuntimeDir } from './config.js';

interface StoredUser {
  username: string;
  passwordHash: string;
}

export interface AuthResult {
  ok: boolean;
  token?: string;
  error?: string;
}

export interface TokenPayload {
  username: string;
}

interface AuthConfig {
  runtimeDir: string;
  jwtSecret?: string;
  allowRegistration?: string;
}

const SALT_ROUNDS = 10;

export class Auth {
  private usersFile: string;
  private secret: string;
  private allowRegistration: string | undefined;
  private users: StoredUser[];

  constructor(config: AuthConfig) {
    ensureRuntimeDir(config.runtimeDir);
    this.usersFile = join(config.runtimeDir, 'users.json');
    this.allowRegistration = config.allowRegistration;
    this.secret = config.jwtSecret || this.loadOrGenerateSecret(config.runtimeDir);
    this.users = this.loadUsers();
  }

  private loadOrGenerateSecret(runtimeDir: string): string {
    const secretFile = join(runtimeDir, 'jwt-secret');
    if (existsSync(secretFile)) {
      return readFileSync(secretFile, 'utf-8').trim();
    }
    const secret = randomBytes(32).toString('hex');
    writeFileSync(secretFile, secret, { mode: 0o600 });
    return secret;
  }

  private loadUsers(): StoredUser[] {
    try {
      return JSON.parse(readFileSync(this.usersFile, 'utf-8'));
    } catch {
      return [];
    }
  }

  private saveUsers(): void {
    writeFileSync(this.usersFile, JSON.stringify(this.users, null, 2) + '\n', { mode: 0o600 });
  }

  private signToken(username: string): string {
    return jwt.sign({ username } satisfies TokenPayload, this.secret, { expiresIn: '30d' });
  }

  async register(username: string, password: string, callerToken?: string): Promise<AuthResult> {
    // Check if registration is allowed
    if (this.allowRegistration === 'false') {
      return { ok: false, error: 'Registration is disabled' };
    }

    if (this.allowRegistration !== 'true' && this.users.length > 0) {
      // Auto mode: require auth after first user
      if (!callerToken) {
        return { ok: false, error: 'Registration requires auth — log in first' };
      }
      if (!this.verifyToken(callerToken)) {
        return { ok: false, error: 'Invalid auth token' };
      }
    }

    if (this.users.some(u => u.username === username)) {
      return { ok: false, error: `User "${username}" already exists` };
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    this.users.push({ username, passwordHash });
    this.saveUsers();

    return { ok: true, token: this.signToken(username) };
  }

  async login(username: string, password: string): Promise<AuthResult> {
    const user = this.users.find(u => u.username === username);
    if (!user) {
      return { ok: false, error: 'Invalid credentials' };
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return { ok: false, error: 'Invalid credentials' };
    }

    return { ok: true, token: this.signToken(username) };
  }

  verifyToken(token: string): TokenPayload | null {
    try {
      const payload = jwt.verify(token, this.secret) as TokenPayload;
      if (payload.username) return payload;
      return null;
    } catch {
      return null;
    }
  }

  get userCount(): number {
    return this.users.length;
  }
}
