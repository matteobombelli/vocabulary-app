# vocabulary-app

Vocabulary trainer at https://vocab.matteob.dev, with English and French courses.

- **Assessment**: about 50 adaptive questions, mostly multiple choice with some typed definitions. They
  estimate how many words of the frequency list you know and where learning should start.
- **Learning**: new words in frequency order from that point, test-first. You type a definition or
  press "I don't know", and Claude Haiku grades typed answers (any real sense of the word counts).
  Every answer shows the definition, dictionary glosses and an example. Missed words come back 3–5
  cards later and again at the start of the next session.
- **Review**: Leitner boxes at 1, 3, 7, 14 and 30 days.
- **French**: each user picks whether definitions are shown in French or English, and which
  language typed answers may be in (Settings on the French course).

The UI follows todo.matteob.dev's design system (`src/styles.css` ports its tokens and components):
Apple's system colours and font, grouped cells, a tab bar on phones, a header on tablets and a
sidebar from 960px.

Installable as a PWA on phones and desktops ("Add to Home Screen"): a service worker caches the
app shell, so the app opens instantly and says when it is offline; answers always need the network.
A "New version available" toast offers a reload after each deploy. Icons come from
`scripts/generate-icons.mjs` (`npm run icons`).

Built with **Vite + React + TypeScript**, deployed as one Cloudflare Worker with static
assets and a **D1** database (`vocabulary-app`). The word lists come from the offline pipeline in
`pipeline/`.

## Develop

```bash
npm install
cp .dev.vars.example .dev.vars   # invite code, stub grader
npm run dev                      # migrate local D1 + vite build + wrangler dev
npm run db:fixture:local         # load synthetic words (until the real seed is loaded)
npm run dev:ui                   # vite with HMR, proxies the API to wrangler dev on :8787
npm run typecheck
npm run types                    # regenerate worker-configuration.d.ts after editing wrangler.jsonc
```

Open http://localhost:8787/ and register with the invite code from
`.dev.vars`. With `GRADER_MODE=stub` typed answers are graded locally: an answer counts as correct
when it shares a word of four or more letters with the definition. Set `GRADER_MODE=claude` and
`ANTHROPIC_API_KEY` to use the real grader.

## Database

`migrations/0001_init.sql` defines the schema; its comments describe every column. `words` is written
only by the seed. Ids are the language base plus rank (en 1,000,000, fr 2,000,000). Ranks cover every
lemma that passed the dictionary filters; `eligible` marks those that can be taught.

D1 bills rows scanned, so every per-request query is an index range: words by `(lang, eligible,
rank)`, a user's words by `(user_id, lang, status, due_at)`, attempts by `(user_id, created_at)`.

```bash
npm run db:migration -- <name>   # create migrations/NNNN_<name>.sql
npm run db:migrate:local
```

## Grading and budget

`worker/services/grader.ts` grades every typed answer with `claude-haiku-5-5` (low effort) and gets
back a structured verdict (correct / partial / incorrect) plus one line of feedback. A "partial"
verdict, where Haiku is least reliable, is graded again by `claude-sonnet-5-5` (medium effort), and
Sonnet's verdict stands. The system prompt is the same for every answer, so it is prompt-cached.

The target is 99% accuracy on correct vs. not correct, at more than 10,000 graded answers a month
for $5. On the 100 hand-labelled answers in `test/grader-eval/`, this setup scores 100% (English) and
98% (French; the one miss is a debatable label). It costs about $0.00025–0.00033 per answer
($2.50–3.30 per 10k) with a warm cache, and up to about $0.00047 with a cold one. 100 answers can't
pin down 99%: confirm it on real attempts.

Every attempt records its tokens, `escalated` and `cost_micro_usd`, and `api_usage` keeps the monthly
total. Two thresholds of `MONTHLY_BUDGET_USD` (wrangler.jsonc, default $5) apply:

- at 70%, "partial" verdicts are no longer re-graded by Sonnet
- at 90%, typed answers pause and every card becomes multiple choice

Typed answers also pause after `DAILY_GRADED_CAP` graded answers for a user in a day (default 200),
or when no API key is set.

`npm run eval:grader` runs the labelled answers against the real models (key from
`ANTHROPIC_API_KEY`, or else `.dev.vars`) and writes the report to `test-results/grader-eval-*.txt`.
`EVAL_ESCALATE=0` grades with Haiku alone.

## Test

```bash
npm test                          # vite build + vitest (unit + Workers pool)
npx playwright install chromium   # once
npm run test:e2e                  # Playwright against wrangler dev on :8788 with fixture words
```

- `test/unit/`: assessment fit (simulated test-takers recover their vocabulary size), Leitner
  scheduling, the session queue.
- `test/worker/`: every route in the Workers runtime, with migrations applied, fixture words, and
  the stub grader.
- `e2e/`: registration, a learning session where a missed word comes back, French settings, the
  assessment, deep links, the manifest and the service worker.

## Deploy

```bash
npx wrangler secret put REGISTRATION_SECRET   # invite code for friends
npx wrangler secret put ANTHROPIC_API_KEY     # Console key on the API credits
npm run deploy                                # vite build + remote migrations + wrangler deploy
```

Then load the seed chunks from `pipeline/` (see `pipeline/README.md`):

```bash
for f in pipeline/data/seed/*.sql; do npx wrangler d1 execute vocabulary-app --remote --file "$f"; done
```

## Routing

- The Worker owns `vocab.matteob.dev` as a Custom Domain (`wrangler.jsonc`); `wrangler deploy`
  creates the DNS record and certificate.
- Vite builds into `dist/`, served from the root. The Worker runs first only for `/api/*`.
- The `spa-404` Vite plugin emits `404.html`, which Workers Assets serves for deep links.

## Data licences

Open English WordNet (CC BY 4.0), Lexique 3 (CC BY-SA 4.0), Wiktionary via kaikki.org (CC BY-SA),
Peter Norvig's `count_1w.txt` word counts. The app footer credits them.
