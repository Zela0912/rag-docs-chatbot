/**
 * npm run eval           retrieval only (embeddings, ~free): does the right chunk come back?
 * npm run eval -- --e2e  full pipeline with the chat model: does the answer cite it, and refuse when it should?
 *
 * Writes data/eval/report.md. Re-run it after changing chunking, the prompt, TOP_K,
 * MIN_SCORE or a model, and compare the numbers before you commit the change.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';
import type { ChatTurn } from '../../shared/chat-protocol.ts';
import { buildSearchQuery, runChat } from '../src/chat/service.ts';
import { loadConfig } from '../src/config.ts';
import { createOpenAIAnswerer, createOpenAIEmbedder } from '../src/llm/openai.ts';
import { type Hit, Retriever } from '../src/retrieve.ts';
import { Store } from '../src/store.ts';

interface EvalQuestion {
  id: string;
  question: string;
  expect: 'answer' | 'not_found' | 'partial';
  /** Acceptable sources as "file#location". Any one of them counts as a hit. */
  sources?: string[];
  note?: string;
  /** Earlier turns, for follow-up questions. */
  history?: ChatTurn[];
}

interface Row {
  q: EvalQuestion;
  rank: number | null; // 1-based rank of the first acceptable chunk in top-K, after the threshold
  topScore: number;
  rejected: boolean; // nothing passed MIN_SCORE
  e2e?: {
    pass: boolean;
    answer: string;
    cited: number[];
    notFound: boolean;
    inputTokens: number;
    outputTokens: number;
  };
}

const e2e = process.argv.includes('--e2e');
const config = loadConfig();
const evalDir = path.resolve(config.docsDir, '../eval');
const { questions } = JSON.parse(await readFile(path.join(evalDir, 'questions.json'), 'utf8')) as {
  questions: EvalQuestion[];
};

const openai = new OpenAI({ apiKey: config.openaiApiKey });
const store = new Store(config.dbPath);
const retriever = new Retriever(store, createOpenAIEmbedder(openai, config.embeddingModel), {
  hybrid: config.hybridSearch,
});
const answerer = createOpenAIAnswerer(openai, config.chatModel, { maxOutputTokens: config.maxOutputTokens });
const settings = { topK: config.topK, minScore: config.minScore, productName: config.productName };

if (retriever.size === 0) {
  console.error('The index is empty. Run `npm run ingest` first.');
  process.exit(1);
}

const key = (hit: Pick<Hit, 'file' | 'location'>) => `${hit.file}#${hit.location}`;
const rows: Row[] = [];

for (const q of questions) {
  const history = q.history ?? [];
  // Same query building as production, so follow-ups are rewritten here too.
  const search = await buildSearchQuery(q.question, history, answerer, AbortSignal.timeout(30_000));
  const hits = await retriever.search(search.query, config.topK);
  const passing = hits.filter((h) => h.score >= config.minScore);
  const index = passing.findIndex((h) => q.sources?.includes(key(h)));
  const row: Row = {
    q,
    rank: index >= 0 ? index + 1 : null,
    topScore: hits[0]?.score ?? 0,
    rejected: passing.length === 0,
  };

  if (e2e) {
    const outcome = await runChat(
      { requestId: q.id, question: q.question, history, signal: AbortSignal.timeout(60_000) },
      { retriever, answerer, settings },
      () => {},
    );
    const expectedIds = outcome.sources.filter((s) => q.sources?.includes(key(s))).map((s) => s.id);
    const pass =
      q.expect === 'answer'
        ? !outcome.notFound && outcome.cited.some((id) => expectedIds.includes(id))
        : q.expect === 'not_found'
          ? outcome.notFound
          : true; // partial: judged by a human from the report
    row.e2e = {
      pass,
      answer: outcome.answer,
      cited: outcome.cited,
      notFound: outcome.notFound,
      inputTokens: outcome.usage?.inputTokens ?? 0,
      outputTokens: outcome.usage?.outputTokens ?? 0,
    };
  }

  rows.push(row);
  process.stdout.write('.');
}
store.close();
console.log('\n');

// ---- metrics -------------------------------------------------------------------------
const answerable = rows.filter((r) => r.q.expect === 'answer');
const followUps = answerable.filter((r) => r.q.history?.length);
const offTopic = rows.filter((r) => r.q.expect === 'not_found');
const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(0)}%`);
const frac = (n: number, d: number) => `${n}/${d} (${pct(n, d)})`;

const hit1 = answerable.filter((r) => r.rank === 1).length;
const hitK = answerable.filter((r) => r.rank !== null).length;
const mrr = answerable.reduce((sum, r) => sum + (r.rank ? 1 / r.rank : 0), 0) / answerable.length;
const rejectedOff = offTopic.filter((r) => r.rejected).length;
const falseRejects = answerable.filter((r) => r.rejected).length;

const metrics: [string, string][] = [
  ['Correct source ranked #1', frac(hit1, answerable.length)],
  [`Correct source in top ${config.topK}`, frac(hitK, answerable.length)],
  ['Mean reciprocal rank', mrr.toFixed(3)],
  ['Off-topic blocked before the chat model', frac(rejectedOff, offTopic.length)],
  ['Answerable questions wrongly blocked', frac(falseRejects, answerable.length)],
  [
    `Follow-ups with correct source in top ${config.topK}`,
    frac(followUps.filter((r) => r.rank !== null).length, followUps.length),
  ],
];

if (e2e) {
  const pass = (list: Row[]) => list.filter((r) => r.e2e?.pass).length;
  const inTok = rows.reduce((s, r) => s + (r.e2e?.inputTokens ?? 0), 0);
  const outTok = rows.reduce((s, r) => s + (r.e2e?.outputTokens ?? 0), 0);
  const called = rows.filter((r) => (r.e2e?.inputTokens ?? 0) > 0).length;
  metrics.push(
    ['Answers citing a correct source', frac(pass(answerable), answerable.length)],
    ['Off-topic answered "not found"', frac(pass(offTopic), offTopic.length)],
    [
      'Avg tokens per answered question (in / out)',
      called ? `${Math.round(inTok / called)} / ${Math.round(outTok / called)}` : 'n/a',
    ],
  );
}

// ---- report --------------------------------------------------------------------------
const escapeCell = (s: string) => s.replaceAll('|', '\\|').replaceAll('\n', ' ');
const lines = [
  '# Evaluation report',
  '',
  `Generated by \`npm run eval${e2e ? ' -- --e2e' : ''}\` on ${new Date().toISOString().slice(0, 10)}.`,
  '',
  `Models: embeddings \`${config.embeddingModel}\`${e2e ? `, chat \`${config.chatModel}\`` : ''}. ` +
    `Retrieval: ${config.hybridSearch ? 'hybrid (vector + BM25, RRF)' : 'vector only'}, TOP_K=${config.topK}, MIN_SCORE=${config.minScore}. ` +
    `${questions.length} questions: ${answerable.length} answerable, ${offTopic.length} off-topic, ` +
    `${rows.length - answerable.length - offTopic.length} partially covered.`,
  '',
  '| Metric | Result |',
  '|---|---|',
  ...metrics.map(([name, value]) => `| ${name} | ${value} |`),
  '',
  '## Per question',
  '',
  `| ID | Expect | Top score | Rank of correct source |${e2e ? ' Pass |' : ''}`,
  `|---|---|---|---|${e2e ? '---|' : ''}`,
  ...rows.map(
    (r) =>
      `| ${r.q.id} | ${r.q.expect} | ${r.topScore.toFixed(3)} | ${r.q.expect === 'answer' ? (r.rank ?? '✗ missed') : r.rejected ? 'blocked' : '-'} |` +
      (e2e ? ` ${r.q.expect === 'partial' ? 'review' : r.e2e?.pass ? '✓' : '✗'} |` : ''),
  ),
];

if (e2e) {
  const review = rows.filter((r) => r.q.expect === 'partial' || !r.e2e?.pass);
  lines.push('', '## Answers to review', '', 'Partially covered questions, plus anything that failed.', '');
  for (const r of review) {
    lines.push(`### ${r.q.id}`, '', `**Q:** ${r.q.question}`, '');
    if (r.q.note) lines.push(`**What good looks like:** ${r.q.note}`, '');
    lines.push(`**A:** ${escapeCell(r.e2e?.answer ?? '')}`, '');
  }
}

await writeFile(path.join(evalDir, 'report.md'), `${lines.join('\n')}\n`);

console.table(Object.fromEntries(metrics));
const misses = answerable.filter((r) => r.rank === null);
if (misses.length) console.log('Retrieval misses:', misses.map((r) => r.q.id).join(', '));
console.log(`Report written to ${path.relative(process.cwd(), path.join(evalDir, 'report.md'))}`);
