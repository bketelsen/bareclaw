import { homedir } from 'os';
import { mkdirSync } from 'fs';

/** Sanitize a channel name to prevent path traversal and shell metacharacters. */
export function sanitizeChannel(channel: string): string {
  return channel.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 128);
}

/** Ensure the runtime directory exists with owner-only permissions. */
export function ensureRuntimeDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export interface Config {
  port: number;
  host: string;
  runtimeDir: string;
  cwd: string;
  maxTurns: number;
  allowedTools: string;
  /**
   * Per-message timeout in milliseconds. Must be 0 (disabled) in production.
   *
   * BAREclaw sessions are persistent and agentic — a single response may
   * involve multi-step tool use that takes minutes. A non-zero timeout would
   * kill the socket mid-response, corrupt the channel's queue state, and
   * force a session host respawn. Only set this non-zero for debugging hangs.
   */
  timeoutMs: number;
  httpToken: string | undefined;
  telegramToken: string | undefined;
  allowedUsers: number[];
  sessionFile: string;
}

export function loadConfig(): Config {
  const allowedUsersRaw = process.env.BARECLAW_ALLOWED_USERS?.trim();
  return {
    port: parseInt(process.env.BARECLAW_PORT || '3000', 10),
    host: process.env.BARECLAW_HOST || '127.0.0.1',
    runtimeDir: process.env.BARECLAW_RUNTIME_DIR || `${homedir()}/.bareclaw`,
    cwd: (process.env.BARECLAW_CWD || homedir()).replace(/^~/, homedir()),
    maxTurns: parseInt(process.env.BARECLAW_MAX_TURNS || '25', 10),
    allowedTools: process.env.BARECLAW_ALLOWED_TOOLS || 'Read,Glob,Grep,Bash,Write,Edit,Skill,Task',
    timeoutMs: parseInt(process.env.BARECLAW_TIMEOUT_MS || '0', 10),
    httpToken: process.env.BARECLAW_HTTP_TOKEN || undefined,
    telegramToken: process.env.BARECLAW_TELEGRAM_TOKEN || undefined,
    allowedUsers: allowedUsersRaw
      ? allowedUsersRaw.split(',').map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite)
      : [],
    sessionFile: process.env.BARECLAW_SESSION_FILE || '.bareclaw-sessions.json',
  };
}
