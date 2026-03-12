import express, { type Router, type Request, type Response, type NextFunction } from 'express';
import { readdirSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { type Config, sanitizeChannel } from '../config.js';
import type { ProcessManager } from '../core/process-manager.js';
import type { ChannelContext, PushMedia, SendMessageRequest } from '../core/types.js';
import type { PushRegistry } from '../core/push-registry.js';

export function createHttpAdapter(config: Config, processManager: ProcessManager, restart: () => void, pushRegistry: PushRegistry): Router {
  const router = express.Router();

  // Block cross-origin requests — browsers send Origin on cross-site fetches.
  // Legitimate API clients (curl, scripts, heartbeat) never send this header.
  router.use((req: Request, res: Response, next: NextFunction) => {
    if (req.headers.origin) {
      res.status(403).json({ error: 'Cross-origin requests are not allowed' });
      return;
    }
    next();
  });

  // Bearer token auth middleware
  if (config.httpToken) {
    router.use((req: Request, res: Response, next: NextFunction) => {
      const header = req.headers.authorization;
      if (header !== `Bearer ${config.httpToken}`) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      next();
    });
  }

  router.post('/message', async (req, res) => {
    const { text, channel, content } = req.body as SendMessageRequest & { content?: unknown };

    // Accept either "text" (string) or "content" (ContentBlock[]) for multimodal
    const messageContent = content && Array.isArray(content) ? content : text;

    if (!messageContent || (typeof messageContent === 'string' && !messageContent.trim())) {
      res.status(400).json({ error: 'Missing "text" or "content" field' });
      return;
    }

    const ch = sanitizeChannel(channel || 'http');
    const context: ChannelContext = { channel: ch, adapter: 'http' };
    const label = typeof messageContent === 'string'
      ? messageContent.substring(0, 80) + (messageContent.length > 80 ? '...' : '')
      : `[${(messageContent as unknown[]).length} content blocks]`;
    console.log(`[http] ← ${ch}: ${label}`);

    try {
      const response = await processManager.send(ch, messageContent, context);
      console.log(`[http] → ${ch}: ${response.duration_ms}ms`);
      res.json(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[http] error on channel ${ch}: ${message}`);
      res.status(500).json({ error: message });
    }
  });

  router.post('/send', async (req, res) => {
    const { channel, text, media } = req.body as { channel?: string; text?: string; media?: PushMedia };

    if (!channel || typeof channel !== 'string') {
      res.status(400).json({ error: 'Missing "channel" field' });
      return;
    }
    if (media && (!media.filePath || typeof media.filePath !== 'string')) {
      res.status(400).json({ error: 'media.filePath must be a string' });
      return;
    }
    if (!text && !media) {
      res.status(400).json({ error: 'Missing "text" or "media" field' });
      return;
    }

    const ch = sanitizeChannel(channel);
    const label = text ? text.substring(0, 80) + (text.length > 80 ? '...' : '') : `[media: ${media!.filePath}]`;
    console.log(`[http] /send -> ${ch}: ${label}`);

    try {
      const sent = await pushRegistry.send(ch, text || '', media);
      if (sent) {
        res.json({ status: 'sent', channel: ch });
      } else {
        res.status(404).json({
          error: `No push handler for channel: ${ch}`,
          registered_prefixes: pushRegistry.prefixes,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[http] /send error: ${message}`);
      res.status(500).json({ error: message });
    }
  });

  router.post('/restart', (_req, res) => {
    console.log('[http] restart requested');
    res.json({ status: 'restarting' });
    // Delay to let the response flush
    setTimeout(restart, 100);
  });

  // --- Memory endpoints ---

  router.get('/memory', (_req, res) => {
    try {
      const memDir = resolve(config.runtimeDir, 'memory');
      let files: string[] = [];
      try {
        files = readdirSync(memDir).filter(f => f.endsWith('.md')).sort();
      } catch {}
      const entries = files.map(f => ({
        name: f.replace(/\.md$/, ''),
        content: readFileSync(resolve(memDir, f), 'utf-8'),
      }));
      res.json({ entries });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  router.post('/memory', (req, res) => {
    const { name, content } = req.body as { name?: string; content?: string };

    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'Missing "name" field' });
      return;
    }
    if (content === undefined || content === null || typeof content !== 'string') {
      res.status(400).json({ error: 'Missing "content" field' });
      return;
    }

    const safeName = sanitizeChannel(name);
    const memDir = resolve(config.runtimeDir, 'memory');
    mkdirSync(memDir, { recursive: true });
    writeFileSync(resolve(memDir, `${safeName}.md`), content);
    console.log(`[http] memory saved: ${safeName}`);
    res.json({ status: 'saved', name: safeName });
  });

  router.delete('/memory', (req, res) => {
    const { name } = req.body as { name?: string };

    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'Missing "name" field' });
      return;
    }

    const safeName = sanitizeChannel(name);
    const memDir = resolve(config.runtimeDir, 'memory');
    try {
      unlinkSync(resolve(memDir, `${safeName}.md`));
    } catch {}
    console.log(`[http] memory deleted: ${safeName}`);
    res.json({ status: 'deleted', name: safeName });
  });

  return router;
}
