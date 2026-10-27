-- Per-answer grading cost, so the real escalation rate and cost per answer can be checked
-- against the budget: escalated = 1 when Haiku's "partial" was re-graded by Sonnet.
ALTER TABLE attempts ADD COLUMN escalated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attempts ADD COLUMN cost_micro_usd REAL NOT NULL DEFAULT 0;
