import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router";
import type { Answer, AnswerResult, Card, Course, Status } from "../../shared/api";
import { reinsert } from "../../shared/queue";
import { ApiError } from "../api/client";
import { courses, status as fetchStatus, study } from "../api/endpoints";
import { AnswerPanel } from "../components/AnswerPanel";
import { ChoiceOnlyBanner } from "../components/ChoiceOnlyBanner";
import { PageHeader } from "../components/PageHeader";
import { QuestionCard } from "../components/QuestionCard";
import { Spinner } from "../components/Spinner";
import { t } from "../strings";
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
  if (!queue || !course) {
    return (
      <>
        <PageHeader title={title} back={`/${lang}`} />
        {error ? <p className="text-bad">{error}</p> : <Spinner />}
      </>
    );
  }

  const current = queue[0];
  const label = current?.retry ? t.again : current?.card.isNew ? t.newWord : undefined;

  return (
    <>
      <PageHeader title={title} back={`/${lang}`}>
        {queue.length > 0 && <span className="text-sm text-muted">{queue.length}</span>}
      </PageHeader>
      <div className="space-y-4">
        <ChoiceOnlyBanner status={status} />
        {error && <p className="text-bad">{error}</p>}

        {answered ? (
          <AnswerPanel lemma={answered.item.card.lemma} result={answered.result} onContinue={onContinue} />
        ) : current ? (
          <QuestionCard card={current.card} answerLang={course.answerLang} busy={busy} label={label} onAnswer={(a) => void onAnswer(a)} />
        ) : (
          <div className="card space-y-3">
            {tally.total > 0 ? (
              <>
                <h2 className="text-xl font-semibold">{t.sessionDone}</h2>
                <p>{t.sessionSummary(tally.right, tally.total)}</p>
              </>
            ) : (
              <p>{mode === "learn" ? t.nothingToLearn : t.nothingToReview}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {mode === "learn" && tally.total > 0 && (
                <button type="button" className="btn btn-primary" onClick={() => void load()}>
                  {t.moreWords}
                </button>
              )}
              <Link to={`/${lang}`} className="btn">
                {t.back}
              </Link>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
