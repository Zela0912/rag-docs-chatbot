import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { ApiErrorBody } from '../../shared/chat-protocol.ts';
import type { ChatDeps } from './chat/service.ts';
import type { Logger } from './logger.ts';
import { serializeError } from './logger.ts';
import { chatRouter } from './routes/chat.ts';

export interface AppOptions extends ChatDeps {
  logger: Logger;
  rateLimitPerMinute: number;
  trustProxy: number;
  /** Built web client (web/dist). Served when present, so production is a single process. */
  webDistDir?: string;
}

export function createApp(options: AppOptions): express.Express {
  const { logger, retriever, answerer } = options;
  const app = express();

  app.disable('x-powered-by');
  if (options.trustProxy > 0) app.set('trust proxy', options.trustProxy);
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, chunks: retriever.size, chatModel: answerer.model });
  });

  // Every chat request costs money, so cap it per IP. A public demo link will get poked at.
  app.use(
    '/api/chat',
    rateLimit({
      windowMs: 60_000,
      limit: options.rateLimitPerMinute,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: {
        error: 'Too many questions in a short time. Please wait a minute and try again.',
      } satisfies ApiErrorBody,
    }),
  );
  app.use(chatRouter(options));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' } satisfies ApiErrorBody);
  });

  const webDist = options.webDistDir;
  if (webDist && existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  // Express 5 forwards errors from async handlers here. Never leak internals to the client.
  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    logger.error('http.unhandled', { error: serializeError(err) });
    if (res.headersSent) {
      res.end();
      return;
    }
    const status = typeof err?.status === 'number' && err.status < 500 ? err.status : 500;
    res.status(status).json({
      error: status === 500 ? 'Something went wrong. Please try again.' : 'Bad request',
    } satisfies ApiErrorBody);
  };
  app.use(errorHandler);

  return app;
}
