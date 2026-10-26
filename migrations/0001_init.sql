-- Vocabulary app v1 schema.
-- User ids are TEXT UUIDs, timestamps INTEGER unix milliseconds.
-- D1 bills rows scanned, so every query the app runs per request is an index range.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- id is hex(sha256(session token)); the raw token only ever lives in the cookie.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- One row per lemma, written only by the seed (pipeline/). Ranks are per language, 1 = most
-- frequent, and cover every lemma that passed the dictionary filters, eligible or not: the
-- vocabulary estimate sums over the whole list.
--
-- id = language base + rank (en 1_000_000, fr 2_000_000), so seeds are reproducible and ids
--   never collide across languages.
-- glosses: JSON {"en": [..], "fr": [..]}, dictionary definitions in sense order, up to 3 per
--   language. A language may be missing (the English course has no "fr").
-- definition: JSON {"en": "..", "fr": ".."}, the learner-relevant sense as one short definition
--   written in the same style as the distractors (it is the right answer in multiple choice).
-- distractors: JSON {"en": [3], "fr": [3]}, plausible wrong definitions per definition language.
-- example: one sentence in the word's own language.
-- flags: JSON array of "jargon" | "archaic" | "offensive" | "technical".
-- band: floor((rank - 1) / 2500).
-- source_model: the model whose enrichment was kept (Haiku, or Sonnet after a takeover).
CREATE TABLE words (
  id INTEGER PRIMARY KEY,
  lang TEXT NOT NULL,
  lemma TEXT NOT NULL,
  rank INTEGER NOT NULL,
  pos TEXT NOT NULL,
  glosses TEXT NOT NULL,
  definition TEXT NOT NULL,
  distractors TEXT NOT NULL,
  example TEXT NOT NULL,
  usefulness INTEGER NOT NULL,
  flags TEXT NOT NULL DEFAULT '[]',
  eligible INTEGER NOT NULL,
  band INTEGER NOT NULL,
  source_model TEXT NOT NULL,
  UNIQUE (lang, rank)
);

CREATE INDEX idx_words_lang_eligible_rank ON words(lang, eligible, rank);

-- A user's settings and progress in one language. def_lang: the language definitions are shown
-- in (and multiple-choice options are written in); answer_lang: 'en' | 'fr' | 'either'.
-- cursor_rank: the highest rank answered as a new word, so the next new words start after it.
CREATE TABLE courses (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lang TEXT NOT NULL,
  def_lang TEXT NOT NULL,
  answer_lang TEXT NOT NULL,
  start_rank INTEGER,
  est_size INTEGER,
  cursor_rank INTEGER NOT NULL DEFAULT 0,
  assessed_at INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, lang)
);

-- status 'known': box 1-5 with due_at, or box NULL and due_at NULL when it was known at
-- assessment (never reviewed). status 'learning': box 0, due_at when it comes back.
CREATE TABLE user_words (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word_id INTEGER NOT NULL REFERENCES words(id),
  lang TEXT NOT NULL,
  status TEXT NOT NULL,
  box INTEGER,
  due_at INTEGER,
  fail_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, word_id)
);

CREATE INDEX idx_user_words_due ON user_words(user_id, lang, status, due_at);

-- An adaptive assessment in progress or finished. state: JSON (shared/assessment.ts).
-- a, b: the fitted P(known) = sigmoid(a + b * ln(rank)).
CREATE TABLE assessments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lang TEXT NOT NULL,
  state TEXT NOT NULL,
  a REAL,
  b REAL,
  est_size INTEGER,
  start_rank INTEGER,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE INDEX idx_assessments_user ON assessments(user_id, lang, created_at);

-- mode: 'assessment' | 'learn' | 'review'; kind: 'typed' | 'choice' | 'dontknow';
-- verdict: 'correct' | 'partial' | 'incorrect'. Tokens are 0 unless the answer was graded.
CREATE TABLE attempts (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word_id INTEGER NOT NULL,
  mode TEXT NOT NULL,
  kind TEXT NOT NULL,
  answer TEXT,
  verdict TEXT NOT NULL,
  graded INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_attempts_user_created ON attempts(user_id, created_at);

-- Running Claude API totals per calendar month ('YYYY-MM', UTC), for the budget guard.
CREATE TABLE api_usage (
  month TEXT PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micro_usd REAL NOT NULL DEFAULT 0
);
