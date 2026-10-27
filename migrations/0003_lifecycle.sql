-- v2 learning model: levels, word tiers, game content, and a per-word lifecycle
-- (intro multiple choice -> games -> define -> known, with decay) replacing Leitner boxes.

-- games: JSON {"synonyms": [..], "antonyms": [..], "cloze": {"sentence": "..___..", "answer": "..",
--   "bank": [3]}, "usage": {"correct": "..", "wrong": [3]}} in the word's own language, for the
--   defined sense; '{}' until the pipeline's games stage has run for the word.
-- tier: who is taught the word. 3 core (usefulness >= 4), 2 general (3), 1 rare (2, not technical
--   or jargon), 0 never taught (ineligible, or a rare specialist term). Learners see the tiers of
--   their level (shared/levels.ts); ranks are unchanged, so the vocabulary estimate still sums over
--   the whole list.
ALTER TABLE words ADD COLUMN games TEXT NOT NULL DEFAULT '{}';
ALTER TABLE words ADD COLUMN tier INTEGER NOT NULL DEFAULT 0;

UPDATE words SET tier = CASE
  WHEN eligible = 0 THEN 0
  WHEN usefulness >= 4 THEN 3
  WHEN usefulness = 3 THEN 2
  WHEN flags LIKE '%"technical"%' OR flags LIKE '%"jargon"%' THEN 0
  ELSE 1
END;

CREATE INDEX idx_words_lang_tier_rank ON words(lang, tier, rank);

-- level: 'beginner' | 'intermediate' | 'fluent' | 'native', NULL until the learner picks one.
-- adapt_right / adapt_total: first-sight answers on new words since the last adaptive check
-- (worker/routes/study.ts moves cursor_rank up or down a band every ADAPT_WINDOW of them).
ALTER TABLE courses ADD COLUMN level TEXT;
ALTER TABLE courses ADD COLUMN adapt_right INTEGER NOT NULL DEFAULT 0;
ALTER TABLE courses ADD COLUMN adapt_total INTEGER NOT NULL DEFAULT 0;
-- cursor_rank alone now says where new words start (adaptive moves can take it below start_rank).
UPDATE courses SET cursor_rank = MAX(cursor_rank, start_rank - 1) WHERE start_rank IS NOT NULL;

-- status is now the word's stage: 'intro' (multiple choice until right) | 'games' | 'define' |
--   'known'. due_at: when an intro/games/define word may be served (define waits after the last
--   game), or when a known word decays back to define; NULL for a known word that never decays.
-- completions (was box): times the word was defined right; NULL when it was known at assessment.
-- games_needed / games_done: games to win before define (1 after a right first sight, else 3).
-- failed_at: the first miss in any stage, kept once set ("recovered" words are known ones with it).
ALTER TABLE user_words RENAME COLUMN box TO completions;
ALTER TABLE user_words ADD COLUMN games_needed INTEGER NOT NULL DEFAULT 3;
ALTER TABLE user_words ADD COLUMN games_done INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_words ADD COLUMN failed_at INTEGER;

UPDATE user_words SET status = 'intro', completions = 0 WHERE status = 'learning';
UPDATE user_words SET completions = MIN(completions, 4) WHERE status = 'known' AND completions IS NOT NULL;
UPDATE user_words SET failed_at = updated_at WHERE fail_count > 0;

-- stage: the word's stage when answered; game: 'mc' | 'usage' | 'cloze' | 'synonym' | 'antonym' |
-- 'sentence' | 'define' (NULL for assessment answers). kind gains 'match' for board games.
ALTER TABLE attempts ADD COLUMN stage TEXT;
ALTER TABLE attempts ADD COLUMN game TEXT;
