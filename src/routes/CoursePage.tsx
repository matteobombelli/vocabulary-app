import { BookOpen, ChevronRight, Gauge, List, Repeat, type LucideIcon } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import type { Course } from "../../shared/api";
import { courses } from "../api/endpoints";
import { NavBar } from "../components/NavBar";
import { Spinner } from "../components/Spinner";
import { rememberCourse } from "../lastCourse";
import { LANGUAGE_NAMES, t } from "../strings";
import { useLang } from "../useLang";

export default function CoursePage() {
  const lang = useLang();
  const navigate = useNavigate();
  const [course, setCourse] = useState<Course | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!lang) return;
    rememberCourse(lang);
    setCourse(null);
    courses.get(lang).then(setCourse, () => setError(true));
  }, [lang]);

  if (!lang) return <Navigate to="/" replace />;

  async function startFromBeginning() {
    await courses.startFromBeginning(lang!);
    navigate(`/${lang}/learn`);
  }

  return (
    <div className="page">
      <NavBar />
      <h1 className="large-title">{LANGUAGE_NAMES[lang]}</h1>
      {course?.estSize != null && <p className="muted">{t.estimate(course.estSize)}</p>}

      {error ? (
        <p className="error">{t.somethingWrong}</p>
      ) : !course ? (
        <Spinner />
      ) : course.totalWords === 0 ? (
        <p className="empty">{t.noWordsYet}</p>
      ) : (
        <>
          <div className="stats">
            <Stat value={course.known} label={t.known} />
            <Stat value={course.learning} label={t.learning} />
            <Stat value={course.due} label={t.due} />
          </div>

          {course.startRank === null ? (
            <section className="question__actions">
              <p className="muted">{t.findLevelHint}</p>
              <Link to={`/${lang}/assessment`} className="button-link button--primary">
                {t.findLevel}
              </Link>
              <button type="button" className="button--plain" onClick={() => void startFromBeginning()}>
                {t.startFromBeginning}
              </button>
            </section>
          ) : (
            <ul className="rows" style={{ "--inset": "2.6rem" } as CSSProperties}>
              <RowLink to={`/${lang}/learn`} icon={BookOpen} title={t.learn} subtitle={t.learnFrom(course.startRank)} />
              <RowLink to={`/${lang}/review`} icon={Repeat} title={t.review} meta={t.reviewDue(course.due)} />
              <RowLink to={`/${lang}/words`} icon={List} title={t.words} meta={t.wordsCount(course.known + course.learning)} />
              <RowLink to={`/${lang}/assessment`} icon={Gauge} title={t.retakeAssessment} />
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="stats__value">{value.toLocaleString()}</div>
      <div className="stats__label">{label}</div>
    </div>
  );
}

function RowLink(props: { to: string; icon: LucideIcon; title: string; subtitle?: string; meta?: string }) {
  const Icon = props.icon;
  return (
    <li>
      <Link to={props.to} className="row row--link">
        <Icon className="row__icon" size={22} strokeWidth={1.75} aria-hidden="true" />
        <span className="row__body">
          <span className="row__title">{props.title}</span>
          {props.subtitle && <span className="row__subtitle">{props.subtitle}</span>}
        </span>
        {props.meta && <span className="row__meta">{props.meta}</span>}
        <ChevronRight className="row__chevron" size={18} aria-hidden="true" />
      </Link>
    </li>
  );
}
