import { BookOpen, Gauge, List, Repeat, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import type { Course } from "../../shared/api";
import { courses } from "../api/endpoints";
import { PageHeader } from "../components/PageHeader";
import { Spinner } from "../components/Spinner";
import { LANGUAGE_NAMES, t } from "../strings";
import { useLang } from "../useLang";

export default function CoursePage() {
  const lang = useLang();
  const navigate = useNavigate();
  const [course, setCourse] = useState<Course | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (lang) courses.get(lang).then(setCourse, () => setError(true));
  }, [lang]);

  if (!lang) return <Navigate to="/" replace />;
  if (error) return <p className="text-bad">{t.somethingWrong}</p>;
  if (!course) return <Spinner />;

  async function startFromBeginning() {
    await courses.startFromBeginning(lang!);
    navigate(`/${lang}/learn`);
  }

  const started = course.startRank !== null;

  return (
    <>
      <PageHeader title={LANGUAGE_NAMES[lang]} back="/">
        <Link to={`/${lang}/settings`} className="btn px-2 py-2" aria-label={t.settings} title={t.settings}>
          <Settings className="size-4" />
        </Link>
      </PageHeader>

      <div className="card mb-4 grid grid-cols-3 text-center">
        <Stat value={course.known} label={t.known} />
        <Stat value={course.learning} label={t.learning} />
        <Stat value={course.due} label={t.due} />
      </div>

      {course.totalWords === 0 ? (
        <p className="text-muted">{t.noWordsYet}</p>
      ) : (
        <div className="space-y-3">
          {course.estSize !== null && <p className="text-muted">{t.estimate(course.estSize)}</p>}
          {started && <p className="text-sm text-muted">{t.startsAt(course.startRank!)}</p>}

          {!started && (
            <div className="card space-y-3">
              <p>{t.findLevelHint}</p>
              <div className="flex flex-wrap gap-2">
                <Link to={`/${lang}/assessment`} className="btn btn-primary">
                  <Gauge className="size-4" />
                  {t.findLevel}
                </Link>
                <button type="button" className="btn" onClick={() => void startFromBeginning()}>
                  {t.startFromBeginning}
                </button>
              </div>
            </div>
          )}

          {started && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Link to={`/${lang}/learn`} className="btn btn-primary py-3">
                <BookOpen className="size-4" />
                {t.learn}
              </Link>
              {course.due > 0 ? (
                <Link to={`/${lang}/review`} className="btn py-3">
                  <Repeat className="size-4" />
                  {t.review(course.due)}
                </Link>
              ) : (
                <span className="btn cursor-default py-3 text-muted">{t.review(0)}</span>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <Link to={`/${lang}/words`} className="btn">
              <List className="size-4" />
              {t.words}
            </Link>
            {started && (
              <Link to={`/${lang}/assessment`} className="btn">
                <Gauge className="size-4" />
                {t.retakeAssessment}
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold">{value.toLocaleString()}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
