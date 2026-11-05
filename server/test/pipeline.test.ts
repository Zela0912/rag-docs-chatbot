import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ingestDirectory } from '../src/ingest/pipeline.ts';
import { Store } from '../src/store.ts';
import { fakeEmbedder } from './helpers.ts';

describe('ingestDirectory', () => {
  let dir: string;
  let store: Store;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'ingest-test-'));
    store = new Store(':memory:');
    await writeFile(path.join(dir, 'billing.md'), '# Billing\n\n## Refunds\n\nWithin 30 days.\n');
    await writeFile(path.join(dir, 'setup.md'), '# Setup\n\n## Invite\n\nLinks expire after 7 days.\n');
    await writeFile(path.join(dir, 'notes.xlsx'), 'ignored');
  });

  afterEach(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('indexes supported files and ignores the rest', async () => {
    const summary = await ingestDirectory({ docsDir: dir, store, embedder: fakeEmbedder() });
    expect(summary.indexed.map((d) => d.file)).toEqual(['billing.md', 'setup.md']);
    expect(store.allChunks().map((c) => `${c.title} › ${c.location}`)).toEqual(['Billing › Refunds', 'Setup › Invite']);
  });

  it('skips unchanged files on re-run, so re-ingesting costs nothing', async () => {
    const embedder = fakeEmbedder();
    await ingestDirectory({ docsDir: dir, store, embedder });
    const callsAfterFirstRun = embedder.calls.length;

    const summary = await ingestDirectory({ docsDir: dir, store, embedder });
    expect(summary.unchanged).toEqual(['billing.md', 'setup.md']);
    expect(summary.embeddingTokens).toBe(0);
    expect(embedder.calls.length).toBe(callsAfterFirstRun);
  });

  it('re-embeds only the file that changed', async () => {
    await ingestDirectory({ docsDir: dir, store, embedder: fakeEmbedder() });
    await writeFile(path.join(dir, 'billing.md'), '# Billing\n\n## Refunds\n\nWithin 14 days.\n');

    const summary = await ingestDirectory({ docsDir: dir, store, embedder: fakeEmbedder() });
    expect(summary.indexed.map((d) => d.file)).toEqual(['billing.md']);
    expect(summary.unchanged).toEqual(['setup.md']);
    expect(store.allChunks().find((c) => c.file === 'billing.md')?.text).toBe('Within 14 days.');
  });

  it('removes documents whose files were deleted', async () => {
    await ingestDirectory({ docsDir: dir, store, embedder: fakeEmbedder() });
    await unlink(path.join(dir, 'setup.md'));

    const summary = await ingestDirectory({ docsDir: dir, store, embedder: fakeEmbedder() });
    expect(summary.removed).toEqual(['setup.md']);
    expect(store.allChunks().map((c) => c.file)).toEqual(['billing.md']);
  });

  it('re-embeds everything when the embedding model changes', async () => {
    await ingestDirectory({ docsDir: dir, store, embedder: fakeEmbedder('model-a') });
    const summary = await ingestDirectory({ docsDir: dir, store, embedder: fakeEmbedder('model-b') });
    expect(summary.indexed).toHaveLength(2);
    expect(summary.unchanged).toEqual([]);
  });
});
