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
 * All persistence lives here. To scale past a few thousand chunks, swap this class for a
 * pgvector-backed one with the same methods; nothing else in the app has to change.
 */
export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
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
    `);
  }

  /** file -> {hash, model}, so ingest can skip files that haven't changed. */
  documentVersions(): Map<string, { hash: string; model: string }> {
    const rows = this.db
      .prepare('SELECT file, content_hash, embedding_model FROM documents')
      .all() as { file: string; content_hash: string; embedding_model: string }[];
    return new Map(rows.map((r) => [r.file, { hash: r.content_hash, model: r.embedding_model }]));
  }

  /** Replace a document and all its chunks atomically: readers never see half a document. */
  replaceDocument(
    doc: { file: string; title: string; hash: string; model: string },
    chunks: NewChunk[],
  ): void {
    this.transaction(() => {
      this.db.prepare('DELETE FROM documents WHERE file = ?').run(doc.file);
      const { lastInsertRowid } = this.db
        .prepare(
          'INSERT INTO documents (file, title, content_hash, embedding_model, ingested_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(doc.file, doc.title, doc.hash, doc.model, new Date().toISOString());

      const insert = this.db.prepare(
        'INSERT INTO chunks (document_id, position, location, text, embedding) VALUES (?, ?, ?, ?, ?)',
      );
      chunks.forEach((chunk, position) => {
        const bytes = new Uint8Array(chunk.embedding.buffer, chunk.embedding.byteOffset, chunk.embedding.byteLength);
        insert.run(lastInsertRowid, position, chunk.location, chunk.text, bytes);
      });
    });
  }

  deleteDocument(file: string): void {
    this.db.prepare('DELETE FROM documents WHERE file = ?').run(file);
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

  close(): void {
    this.db.close();
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
