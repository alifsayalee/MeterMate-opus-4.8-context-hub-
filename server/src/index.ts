import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { config } from './config.js';
import { createLogger } from './logger.js';
import { metaRouter } from './routes/meta.js';
import { bookRouter } from './routes/book.js';
import { checkAuth, isSlackConfigured } from './services/slackService.js';
import { isMaxioConfigured } from './maxioClient.js';

const log = createLogger('server');

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  // Lightweight request log.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    log.debug(`${req.method} ${req.path}`);
    next();
  });

  app.use('/api', metaRouter);
  app.use('/api', bookRouter);

  // 404 for unknown API routes.
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ status: 'not_found' });
  });

  // Centralized error handler: nothing leaks stack traces to clients.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    log.error('Unhandled error in request pipeline', err);
    if (res.headersSent) return;
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  });

  return app;
}

// Only start listening when run directly (not when imported by tests).
const isMain = process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js');
if (isMain) {
  const app = createApp();
  app.listen(config.port, () => {
    log.info(`MeterMate server listening on http://localhost:${config.port}`);
    log.info(`Health: http://localhost:${config.port}/api/health`);
    log.info(`Maxio configured: ${isMaxioConfigured()} · Slack configured: ${isSlackConfigured()}`);

    // Non-blocking boot Slack auth check (plan §3.1). Logs only.
    if (isSlackConfigured()) {
      void checkAuth().then((r) => {
        if (r.ok) log.info(`Slack auth ok${r.detail ? ` (${r.detail})` : ''}`);
        else log.warn(`Slack auth check failed: ${r.detail ?? 'unknown'}`);
      });
    }
  });
}
