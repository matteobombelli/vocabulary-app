import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router";
import type { Answer, AnswerResult, Card, Course, Status } from "../../shared/api";
import { reinsert } from "../../shared/queue";
import { ApiError } from "../api/client";
import { courses, status as fetchStatus, study } from "../api/endpoints";
import { AnswerPanel } from "../components/AnswerPanel";
import { ChoiceOnlyBanner } from "../components/ChoiceOnlyBanner";
import { NavBar } from "../components/NavBar";
import { QuestionCard } from "../components/QuestionCard";
import { Spinner } from "../components/Spinner";
import { LANGUAGE_NAMES, t } from "../strings";
import { useLang } from "../useLang";

interface QueuedCard {
  card: Card;
  // Shown again after a miss in this session.
  retry: boolean;
}

interface Answered {
  item: QueuedCard;
  result: AnswerResult;
}

export default function StudyPage({ mode }: { mode: "learn" | "review" }) {
  const lang = useLang();
  const [course, setCourse] = useState<Course | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [queue, setQueue] = useState<QueuedCard[] | null>(null);
  const [answered, setAnswered] = useState<Answered | null>(null);
  const [tally, setTally] = useState({ right: 0, total: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!lang) return;
    setError(null);
    setQueue(null);
    try {
      const [c, s, cards] = await Promise.all([
        courses.get(lang),
        fetchStatus(),
        mode === "learn" ? study.learn(lang) : study.review(lang),
      ]);
      setCourse(c);
      setStatus(s);
      setQueue(cards.map((card) => ({ card, retry: false })));
      setTally({ right: 0, total: 0 });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.somethingWrong);
    }
  }, [lang, mode]);

  useEffect(() => {
    void load();
  }, [load]);

  const onAnswer = useCallback(
    async (answer: Omit<Answer, "wordId">) => {
      const item = queue?.[0];
      if (!item || busy) return;
      setBusy(true);
      setError(null);
      try {
        const result = await study.answer(lang!, { ...answer, wordId: item.card.wordId, mode, retry: item.retry });
        setAnswered({ item, result });
        if (!item.retry) setTally((x) => ({ right: x.right + (result.verdict === "correct" ? 1 : 0), total: x.total + 1 }));
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) fetchStatus().then(setStatus, () => undefined);
        setError(err instanceof ApiError ? err.message : t.somethingWrong);
      } finally {
        setBusy(false);
      }
    },
    [queue, busy, lang, mode]
  );

  function onContinue() {
    if (!answered || !queue) return;
    const rest = queue.slice(1);
    const missed = answered.result.verdict !== "correct";
    setQueue(missed ? reinsert(rest, { card: answered.item.card, retry: true }) : rest);
    setAnswered(null);
  }

  if (!lang) return <Navigate to="/" replace />;
  const title = mode === "learn" ? t.learnTitle : t.reviewTitle;
  const current = queue?.[0];
  const label = current?.retry ? t.again : current?.card.isNew ? t.newWord : undefined;

  return (
    <div className="page">
      <NavBar
        back={{ to: `/${lang}`, label: LANGUAGE_NAMES[lang] }}
        end={queue && queue.length > 0 && <span>{queue.length}</span>}
      />
      <ChoiceOnlyBanner status={status} />
      {error && <p className="error">{error}</p>}

      {!queue || !course ? (
        <>
          <h1 className="large-title">{title}</h1>
          {!error && <Spinner />}
        </>
      ) : answered ? (
        <AnswerPanel lemma={answered.item.card.lemma} result={answered.result} onContinue={onContinue} />
      ) : current ? (
        <QuestionCard card={current.card} answerLang={course.answerLang} busy={busy} label={label} onAnswer={(a) => void onAnswer(a)} />
      ) : (
        <div className="question">
          <h1 className="large-title">{tally.total > 0 ? t.sessionDone : title}</h1>
          <p>{tally.total > 0 ? t.sessionSummary(tally.right, tally.total) : mode === "learn" ? t.nothingToLearn : t.nothingToReview}</p>
          <div className="question__actions">
            {mode === "learn" && tally.total > 0 && (
              <button type="button" className="button--primary" onClick={() => void load()}>
                {t.moreWords}
              </button>
            )}
            <Link to={`/${lang}`} className="button-link button--plain">
              {t.back}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
