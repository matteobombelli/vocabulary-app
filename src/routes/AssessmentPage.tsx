import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router";
import type { Answer, AnswerResult, AssessmentOutcome, AssessmentStep, Course, Status } from "../../shared/api";
import { ApiError } from "../api/client";
import { assessment, courses, status as fetchStatus } from "../api/endpoints";
import { AnswerPanel } from "../components/AnswerPanel";
import { ChoiceOnlyBanner } from "../components/ChoiceOnlyBanner";
import { PageHeader } from "../components/PageHeader";
import { QuestionCard } from "../components/QuestionCard";
import { Spinner } from "../components/Spinner";
import { t } from "../strings";
import { useLang } from "../useLang";

type Phase =
  | { kind: "intro" }
  | { kind: "question"; step: AssessmentStep }
  | { kind: "answered"; step: AssessmentStep; result: AnswerResult; next: AssessmentStep | null; outcome: AssessmentOutcome | null }
  | { kind: "outcome"; outcome: AssessmentOutcome };

export default function AssessmentPage() {
  const lang = useLang();
  const [course, setCourse] = useState<Course | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "intro" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!lang) return;
    courses.get(lang).then(setCourse, () => setError(t.somethingWrong));
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
  if (!course) return error ? <p className="text-bad">{error}</p> : <Spinner />;

  const current = phase.kind === "question" || phase.kind === "answered" ? phase.step : null;

  return (
    <>
      <PageHeader title={t.assessmentTitle} back={`/${lang}`}>
        {current && <span className="text-sm text-muted">{t.questionOf(current.index + 1, current.total)}</span>}
      </PageHeader>
      {current && (
        <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-line">
          <div className="h-full bg-accent transition-all" style={{ width: `${(current.index / current.total) * 100}%` }} />
        </div>
      )}
      <div className="space-y-4">
        <ChoiceOnlyBanner status={status} />
        {error && <p className="text-bad">{error}</p>}

        {phase.kind === "intro" && (
          <div className="card space-y-3">
            {t.assessmentIntro.map((p) => (
              <p key={p}>{p}</p>
            ))}
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void begin()}>
              {t.begin}
            </button>
          </div>
        )}

        {phase.kind === "question" && (
          <QuestionCard card={phase.step.card} answerLang={course.answerLang} busy={busy} onAnswer={(a) => void onAnswer(a)} />
        )}

        {phase.kind === "answered" && <AnswerPanel lemma={phase.step.card.lemma} result={phase.result} onContinue={onContinue} />}

        {phase.kind === "outcome" && (
          <div className="card space-y-3">
            <h2 className="text-xl font-semibold">{t.resultTitle}</h2>
            <p className="text-lg">{t.resultSize(phase.outcome.estSize, phase.outcome.totalWords)}</p>
            <div className="h-2 overflow-hidden rounded-full bg-line">
              <div className="h-full bg-accent" style={{ width: `${(phase.outcome.estSize / phase.outcome.totalWords) * 100}%` }} />
            </div>
            <p className="text-muted">{t.resultStart(phase.outcome.startRank)}</p>
            <Link to={`/${lang}/learn`} className="btn btn-primary">
              {t.startLearning}
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
