import { spawn, execFileSync } from 'child_process';
import { createServer } from 'http';
import { existsSync } from 'fs';
import { resolve } from 'path';
import express from 'express';
import { loadConfig } from './config.js';
import { ProcessManager } from './core/process-manager.js';
import { createHttpAdapter } from './adapters/http.js';
import { createTelegramAdapter } from './adapters/telegram.js';
import { PushRegistry } from './core/push-registry.js';
import { Auth } from './auth.js';
import { ConversationStore } from './core/conversations.js';
import { createWebSocketAdapter } from './adapters/ws.js';

const config = loadConfig();
const processManager = new ProcessManager(config);

// Ensure heartbeat scheduled job is installed (launchd on macOS, systemd on Linux)
function ensureHeartbeat(): void {
  const installScript = resolve(import.meta.dirname, '..', 'heartbeat', 'install.sh');
  if (!existsSync(installScript)) return;

  try {
    execFileSync('bash', [installScript], { stdio: 'pipe' });
    console.log('[bareclaw] heartbeat scheduled job installed');
  } catch (err) {
    console.error(`[bareclaw] heartbeat install failed: ${err instanceof Error ? err.message : err}`);
  }
}
ensureHeartbeat();

// Telegram bot cleanup — set during adapter init so shutdown paths can stop polling
let stopTelegram: (() => void) | undefined;
let stopWebSocket: (() => void) | undefined;

// Auth and conversation store
const auth = new Auth({
  runtimeDir: config.runtimeDir,
  jwtSecret: config.jwtSecret,
  allowRegistration: config.allowRegistration,
});
const conversations = new ConversationStore(config.runtimeDir);

// Self-restart: shut down everything, re-exec the same process
function restart() {
  console.log('[bareclaw] restarting...');
  processManager.shutdown();
  stopTelegram?.();
  stopWebSocket?.();
  server.close(() => {
    const child = spawn(process.argv[0]!, process.argv.slice(1), {
      detached: true,
      stdio: 'inherit',
      cwd: process.cwd(),
    });
    child.unref();
    process.exit(0);
  });
  // If server.close hangs, force exit after 3s
  setTimeout(() => process.exit(0), 3000);
}

// Push registry — adapters register handlers for outbound messages via POST /send
const pushRegistry = new PushRegistry();

// Telegram (optional) — register push handler before HTTP so /send is ready at startup
if (config.telegramToken) {
  const { bot, pushHandler } = createTelegramAdapter(config, processManager);
  pushRegistry.register('tg-', pushHandler);
  bot.launch();
  stopTelegram = () => bot.stop();
  console.log(`[bareclaw] Telegram bot started (${config.allowedUsers.length} allowed user(s))`);
} else {
  console.log(`[bareclaw] Telegram disabled (no BARECLAW_TELEGRAM_TOKEN)`);
}

// HTTP
const app = express();
app.use(express.json());

// Auth routes — mounted before HTTP adapter to bypass origin-blocking middleware
app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: 'Missing username or password' });
    return;
  }
  const result = await auth.login(username, password);
  res.status(result.ok ? 200 : 401).json(result);
});

app.post('/auth/register', async (req, res) => {
  const { username, password } = req.body;
  const callerToken = req.headers.authorization?.replace('Bearer ', '');
  if (!username || !password) {
    res.status(400).json({ error: 'Missing username or password' });
    return;
  }
  const result = await auth.register(username, password, callerToken);
  res.status(result.ok ? 201 : 400).json(result);
});

// Existing HTTP adapter (has origin-blocking + bearer token middleware)
app.use(createHttpAdapter(config, processManager, restart, pushRegistry));

// Serve frontend static files (production)
const clientDist = resolve(import.meta.dirname, '..', 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback — serve index.html for all non-API routes
  app.get('*', (_req, res) => {
    res.sendFile(resolve(clientDist, 'index.html'));
  });
}

// Create HTTP server (needed for WS upgrade) and attach WS adapter
const server = createServer(app);
const { stop: wsStop } = createWebSocketAdapter(server, auth, processManager, conversations, pushRegistry, restart);
stopWebSocket = wsStop;

server.listen(config.port, config.host, () => {
  console.log(`[bareclaw] HTTP listening on ${config.host}:${config.port}`);
  if (config.httpToken) {
    console.log(`[bareclaw] HTTP auth enabled (Bearer token)`);
  } else {
    console.log(`[bareclaw] HTTP auth disabled (no BARECLAW_HTTP_TOKEN)`);
  }
  console.log(`[bareclaw] Web auth: ${auth.userCount} user(s) registered`);
});

// SIGTERM (tsx watch sends this on hot reload) — disconnect, keep session hosts alive
process.on('SIGTERM', () => {
  console.log('\n[bareclaw] hot reload — disconnecting from session hosts...');
  processManager.shutdown();
  stopTelegram?.();
  stopWebSocket?.();
  process.exit(0);
});

// SIGINT (Ctrl+C) — full shutdown, kill session hosts
process.on('SIGINT', () => {
  console.log('\n[bareclaw] full shutdown — killing session hosts...');
  processManager.shutdownHosts();
  stopTelegram?.();
  stopWebSocket?.();
  process.exit(0);
});

process.on('SIGHUP', restart);

// Prevent crashes from unhandled errors
process.on('unhandledRejection', (err) => {
  console.error(`[bareclaw] unhandled rejection: ${err instanceof Error ? err.message : err}`);
});
process.on('uncaughtException', (err) => {
  console.error(`[bareclaw] uncaught exception: ${err.message}`);
});
