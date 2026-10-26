# vocabulary-app

Vocabulary trainer at https://apps.matteob.dev/projects/vocabulary-app, with English and French courses.

- **Assessment**: about 50 adaptive questions, mostly multiple choice with some typed definitions. They
  estimate how many words of the frequency list you know and where learning should start.
- **Learning**: new words in frequency order from that point, test-first. You type a definition or
  press "I don't know", and Claude Haiku grades typed answers (any real sense of the word counts).
  Every answer shows the definition, dictionary glosses and an example. Missed words come back 3–5
  cards later and again at the start of the next session.
- **Review**: Leitner boxes at 1, 3, 7, 14 and 30 days.
- **French**: each user picks whether definitions are shown in French or English, and which
  language typed answers may be in (Settings on the French course).

Built with **Vite + React + Tailwind + TypeScript**, deployed as one Cloudflare Worker with static
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

Open http://localhost:8787/projects/vocabulary-app/ and register with the invite code from
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

`worker/services/grader.ts` calls `claude-haiku-5-5` with structured output and gets back a verdict
(correct / partial / incorrect) plus one line of feedback. Token usage goes into `attempts` and the
monthly `api_usage` row. Typed answers pause, and every card becomes multiple choice, when any of
these holds:

- the month's spend reaches 90% of `MONTHLY_BUDGET_USD` (wrangler.jsonc, default $5)
- the user has had `DAILY_GRADED_CAP` graded answers today (default 200)
- no API key is set

`npm run eval:grader` runs the hand-labelled answers in `test/grader-eval/` against the real model and
prints the agreement.

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
  assessment, deep links.

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

- `apps.matteob.dev` is a Cloudflare Tunnel to the home server. The Worker route
  `apps.matteob.dev/projects/vocabulary-app*` in `wrangler.jsonc` takes only this prefix; every other
  path still goes to the tunnel.
- Vite builds with `base: /projects/vocabulary-app/` into `dist/projects/vocabulary-app/`, so asset
  paths match request paths. The Worker runs first only for `/projects/vocabulary-app/api/*`.
- The `spa-404` Vite plugin emits `404.html`, which Workers Assets serves for deep links.

## Data licences

Open English WordNet (CC BY 4.0), Lexique 3 (CC BY-SA 4.0), Wiktionary via kaikki.org (CC BY-SA),
Peter Norvig's `count_1w.txt` word counts. The app footer credits them.
