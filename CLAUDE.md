# CLAUDE.md

Guidance for Claude (and any other contributor) working in this repository.

## What this is

A RAG support chatbot: it answers only from `data/docs`, cites the exact passages, and refuses when the docs don't cover a question. It is a **portfolio project shown to Upwork clients**. Code quality, the README and the evaluation numbers are part of the product.

## Working with Luka

- Talk to Luka in **Croatian**. Code, comments, commit messages, README and UI text are in **English**.
- Go step by step. When a decision matters (architecture, a dependency, a trade-off), explain it in one or two sentences that Luka could repeat to a client.
- Ask before anything outward-facing or hard to undo: pushing, creating or changing the GitHub repo, deploying, paid services, deleting data.
- Never ask Luka to paste the API key into the chat. It lives only in `.env`, which is git-ignored.

## Commands

```bash
npm run dev                      # API :3001 + web :5173 (Vite proxies /api)
npm run check                    # lint + typecheck + test + build. Must pass before every commit
npm test                         # Vitest, server + web, offline
npm run ingest                   # (re)index data/docs, incremental
npm run search -- "question"     # debug retrieval without the chat model
npm run eval [-- --e2e]          # evaluation suite → data/eval/report.md
npm run format                   # Biome: format + organise imports
```

## Architecture in one breath

`shared/chat-protocol.ts` defines the SSE contract. On the server, `chat/service.ts` runs one request: rewrite the follow-up into a standalone query, then hybrid retrieval (`retrieve.ts` + `store.ts`), then the relevance gate, then the answer (`llm/`). `routes/chat.ts` turns that into Server-Sent Events. The web app (`web/src`) is a thin renderer: `hooks/useChat.ts` owns all the state.

## Rules

### TypeScript and runtime

- Node runs `.ts` files directly (type stripping). Use **erasable syntax only**: no `enum`, `namespace` or constructor parameter properties. Import with explicit `.ts` extensions, and use `import type` for types.
- TypeScript 7 (native compiler). typescript-eslint doesn't support it, which is why lint and formatting use **Biome**.
- `strict` is on. Don't use `any` or non-null assertions (`!`). Narrow the type properly instead.

### Architecture

- Code outside `server/src/llm/openai.ts` and `server/src/index.ts` must never import the OpenAI SDK. Everything else depends on the `Embedder` and `Answerer` interfaces, so tests use fakes and the provider can be swapped.
- All persistence goes through `Store`. Keep its methods storage-agnostic, so a pgvector implementation could replace it.
- Change the client–server contract in `shared/chat-protocol.ts` only. Both sides must compile against it.
- Configuration comes from environment variables validated in `server/src/config.ts`. Add every new setting there and in `.env.example`, with a comment.

### Quality bar

- Any change to chunking, retrieval, the prompt, `TOP_K`, `MIN_SCORE` or a model must be measured. Run `npm run eval` (and `-- --e2e` for prompt or model changes), compare with `data/eval/report.md`, and record the before and after numbers in the commit message. Don't tune parameters on a single question.
- When a bug is found in manual or browser testing, add a test or an eval case that would have caught it.
- Tests must run offline and for free. Use the helpers in `server/test/helpers.ts`; never call the real API from `npm test`.
- UI changes must work in light and dark mode, at 390 px width, by keyboard alone, and with reduced motion.

### Security and privacy

- Never log question or answer text. Log shape, ids, scores, token counts and timings.
- Treat document text as untrusted: it goes to the model as data inside `<source>` tags, and the UI renders Markdown without raw HTML.
- Never commit secrets. Before committing, check that `git status` doesn't list `.env` or `data/*.db`.

### Facts, prices and models

- Before writing a price, a model name, a limit or any other market fact into code or docs, check it against the official source, and write down where and when it was checked. Don't rely on memory or third-party aggregators.

### Git

- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`). Keep commits small and focused, and explain the reason in the body.
- `npm run check` must pass before every commit.
