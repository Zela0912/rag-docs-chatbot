import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface StoredChunk {
  id: number;
  file: string;
  title: string;
  location: string;
  text: string;
  embedding: Float32Array;
}

export interface NewChunk {
  location: string;
  text: string;
  embedding: Float32Array;
}

/**
 * All persistence lives here: documents, chunks with their vectors, and a full-text index.
 * To scale past ~50k chunks, swap this class for a Postgres + pgvector one with the same
 * methods; nothing else in the app has to change.
 */
export class Store {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS documents (
        id              INTEGER PRIMARY KEY,
        file            TEXT NOT NULL UNIQUE,
        title           TEXT NOT NULL,
        content_hash    TEXT NOT NULL,
        embedding_model TEXT NOT NULL,
        ingested_at     TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chunks (
        id          INTEGER PRIMARY KEY,
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        position    INTEGER NOT NULL,
        location    TEXT NOT NULL,
        text        TEXT NOT NULL,
        embedding   BLOB NOT NULL
      );
      -- Keyword index (BM25) for hybrid search. rowid = chunks.id.
      -- remove_diacritics lets "kosta" match "košta".
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        title, location, text,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `);
    this.backfillKeywordIndex();
  }

  /** file -> {hash, model}, so ingest can skip files that haven't changed. */
  documentVersions(): Map<string, { hash: string; model: string }> {
    const rows = this.db.prepare('SELECT file, content_hash, embedding_model FROM documents').all() as {
      file: string;
      content_hash: string;
      embedding_model: string;
    }[];
    return new Map(rows.map((r) => [r.file, { hash: r.content_hash, model: r.embedding_model }]));
  }

  /** Replace a document and all its chunks atomically: readers never see half a document. */
  replaceDocument(doc: { file: string; title: string; hash: string; model: string }, chunks: NewChunk[]): void {
    this.transaction(() => {
      this.removeDocument(doc.file);
      const { lastInsertRowid: documentId } = this.db
        .prepare(
          'INSERT INTO documents (file, title, content_hash, embedding_model, ingested_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(doc.file, doc.title, doc.hash, doc.model, new Date().toISOString());

      const insertChunk = this.db.prepare(
        'INSERT INTO chunks (document_id, position, location, text, embedding) VALUES (?, ?, ?, ?, ?)',
      );
      const insertFts = this.db.prepare('INSERT INTO chunks_fts (rowid, title, location, text) VALUES (?, ?, ?, ?)');

      chunks.forEach((chunk, position) => {
        const bytes = new Uint8Array(chunk.embedding.buffer, chunk.embedding.byteOffset, chunk.embedding.byteLength);
        const { lastInsertRowid: chunkId } = insertChunk.run(documentId, position, chunk.location, chunk.text, bytes);
        insertFts.run(chunkId, doc.title, chunk.location, chunk.text);
      });
    });
  }

  deleteDocument(file: string): void {
    this.transaction(() => this.removeDocument(file));
  }

  allChunks(): StoredChunk[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, d.file, d.title, c.location, c.text, c.embedding
         FROM chunks c JOIN documents d ON d.id = c.document_id
         ORDER BY d.file, c.position`,
      )
      .all() as { id: number; file: string; title: string; location: string; text: string; embedding: Uint8Array }[];

    return rows.map((r) => ({
      ...r,
      // Copy into a fresh buffer: Float32Array needs 4-byte alignment.
      embedding: new Float32Array(r.embedding.slice().buffer),
    }));
  }

  /**
   * BM25 keyword search. Returns chunk ids, best match first.
   * Title and section matches weigh more than body text.
   */
  keywordSearch(query: string, limit: number): number[] {
    const match = toMatchQuery(query);
    if (!match) return [];
    const rows = this.db
      .prepare(
        `SELECT rowid AS id FROM chunks_fts
         WHERE chunks_fts MATCH ?
         ORDER BY bm25(chunks_fts, 2.0, 2.0, 1.0)
         LIMIT ?`,
      )
      .all(match, limit) as { id: number }[];
    return rows.map((r) => r.id);
  }

  close(): void {
    this.db.close();
  }

  private removeDocument(file: string): void {
    // FTS tables don't take part in foreign-key cascades, so clean them up explicitly.
    this.db
      .prepare(
        'DELETE FROM chunks_fts WHERE rowid IN (SELECT c.id FROM chunks c JOIN documents d ON d.id = c.document_id WHERE d.file = ?)',
      )
      .run(file);
    this.db.prepare('DELETE FROM documents WHERE file = ?').run(file);
  }

  /** Indexes built before the keyword index existed get it rebuilt once, without re-embedding. */
  private backfillKeywordIndex(): void {
    const count = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n;
    if (count('SELECT count(*) AS n FROM chunks') === count('SELECT count(*) AS n FROM chunks_fts')) return;
    this.transaction(() => {
      this.db.exec('DELETE FROM chunks_fts');
      this.db.exec(
        `INSERT INTO chunks_fts (rowid, title, location, text)
         SELECT c.id, d.title, c.location, c.text FROM chunks c JOIN documents d ON d.id = c.document_id`,
      );
    });
  }

  private transaction(fn: () => void): void {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

// Words that appear in almost every question and only add noise to keyword matching.
const STOPWORDS = new Set(
  (
    'a an and are as at be but by can could do does did for from has have how i if in into is it its me my ' +
    'no not of on or our please should so that the their them then there these they this to us was we what ' +
    'when where which who why will with would you your'
  ).split(' '),
);

/**
 * Turns free text into a safe FTS5 query: every word quoted (so user input can't inject
 * FTS syntax like NEAR or *), stopwords dropped, words OR-ed so partial matches still rank.
 */
export function toMatchQuery(query: string): string | null {
  const words = new Set(
    (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1 && !STOPWORDS.has(w)),
  );
  if (words.size === 0) return null;
  return [...words].map((w) => `"${w}"`).join(' OR ');
}
