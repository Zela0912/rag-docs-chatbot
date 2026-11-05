import express, { type ErrorRequestHandler } from 'express';
import { config } from './config.ts';
import { Retriever } from './retrieve.ts';
import { chatRouter } from './routes/chat.ts';
import { Store } from './store.ts';

const store = new Store(config.dbPath);
const retriever = new Retriever(store);

if (retriever.size === 0) {
  console.warn('⚠ The index is empty. Run `npm run ingest` first.');
}

const app = express();
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, chunks: retriever.size, chatModel: config.chatModel });
});

app.use(chatRouter(retriever));

// Express 5 forwards errors from async handlers here. Never leak internals to the client.
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
};
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`API on http://localhost:${config.port} (${retriever.size} chunks, model ${config.chatModel})`);
});
