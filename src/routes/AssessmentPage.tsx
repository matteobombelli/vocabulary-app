import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router";
import type { Answer, AnswerResult, AssessmentOutcome, AssessmentStep, Status } from "../../shared/api";
import { courseKey, setCached, useCourse } from "../api/cache";
import { ApiError } from "../api/client";
import { assessment, courses, status as fetchStatus } from "../api/endpoints";
import { AnswerPanel } from "../components/AnswerPanel";
import { ChoiceOnlyBanner } from "../components/ChoiceOnlyBanner";
import { NavBar } from "../components/NavBar";
import { QuestionCard } from "../components/QuestionCard";
import { Spinner } from "../components/Spinner";
import { LANGUAGE_NAMES, t } from "../strings";
import { useLang } from "../useLang";

type Phase =
  | { kind: "intro" }
  | { kind: "question"; step: AssessmentStep }
  | { kind: "answered"; step: AssessmentStep; result: AnswerResult; next: AssessmentStep | null; outcome: AssessmentOutcome | null }
  | { kind: "outcome"; outcome: AssessmentOutcome };

export default function AssessmentPage() {
  const lang = useLang();
  const { data: course, error: courseError } = useCourse(lang);
  const [status, setStatus] = useState<Status | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "intro" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!lang) return;
    fetchStatus().then(setStatus, () => undefined);
  }, [lang]);

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      setPhase({ kind: "question", step: await assessment.start(lang!) });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.somethingWrong);
    } finally {
      setBusy(false);
    }
  }

  const onAnswer = useCallback(
    async (answer: Omit<Answer, "wordId">) => {
      if (phase.kind !== "question" || busy) return;
      const step = phase.step;
      setBusy(true);
      setError(null);
      try {
        const res = await assessment.answer(lang!, step.assessmentId, { ...answer, wordId: step.card.wordId });
        setPhase({ kind: "answered", step, ...res });
        if (res.outcome) courses.get(lang!).then((c) => setCached(courseKey(lang!), c), () => undefined);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t.somethingWrong);
      } finally {
        setBusy(false);
      }
    },
    [phase, busy, lang]
  );

  function onContinue() {
    if (phase.kind !== "answered") return;
    if (phase.outcome) setPhase({ kind: "outcome", outcome: phase.outcome });
    else if (phase.next) setPhase({ kind: "question", step: phase.next });
  }

  if (!lang) return <Navigate to="/" replace />;
  const current = phase.kind === "question" || phase.kind === "answered" ? phase.step : null;

  return (
    <div className="page">
      <NavBar
        back={{ to: `/${lang}`, label: LANGUAGE_NAMES[lang] }}
        end={current && <span>{t.questionOf(current.index + 1, current.total)}</span>}
      />
      {phase.kind === "intro" && <h1 className="large-title">{t.assessmentTitle}</h1>}
      {current && (
        <div className="progress" role="progressbar" aria-valuenow={current.index} aria-valuemax={current.total}>
          <div className="progress__bar" style={{ width: `${(current.index / current.total) * 100}%` }} />
        </div>
      )}
      <ChoiceOnlyBanner status={status} />
      {error && <p className="error">{error}</p>}

      {courseError && !course && <p className="error">{t.somethingWrong}</p>}
      {!course ? (
        !error && !courseError && <Spinner />
      ) : (
        <>
          {phase.kind === "intro" && (
            <div className="question__actions">
              {t.assessmentIntro.map((p) => (
                <p key={p}>{p}</p>
              ))}
              <button type="button" className="button--primary" disabled={busy} onClick={() => void begin()}>
                {t.begin}
              </button>
            </div>
          )}

          {phase.kind === "question" && (
            <QuestionCard card={phase.step.card} answerLang={course.answerLang} busy={busy} onAnswer={(a) => void onAnswer(a)} />
          )}

          {phase.kind === "answered" && <AnswerPanel lemma={phase.step.card.lemma} result={phase.result} onContinue={onContinue} />}

          {phase.kind === "outcome" && (
            <div className="question">
              <h1 className="large-title">{t.resultTitle}</h1>
              <p>{t.resultSize(phase.outcome.estSize, phase.outcome.totalWords)}</p>
              <div className="progress">
                <div className="progress__bar" style={{ width: `${(phase.outcome.estSize / phase.outcome.totalWords) * 100}%` }} />
              </div>
              <p className="muted">{t.resultStart(phase.outcome.startRank)}</p>
              <Link to={`/${lang}/study`} className="button-link button--primary" viewTransition>
                {t.startLearning}
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
