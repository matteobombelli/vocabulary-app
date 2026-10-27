import { BookOpen, ChevronRight, Gauge, List, type LucideIcon } from "lucide-react";
import { useEffect, type CSSProperties } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import type { Level } from "../../shared/api";
import { courseKey, prefetchSession, setCached, useCourse } from "../api/cache";
import { courses } from "../api/endpoints";
import { LevelPicker } from "../components/LevelPicker";
import { NavBar } from "../components/NavBar";
import { rememberCourse } from "../lastCourse";
import { LANGUAGE_NAMES, t } from "../strings";
import { useLang } from "../useLang";

export default function CoursePage() {
  const lang = useLang();
  const navigate = useNavigate();
  const { data: course, error } = useCourse(lang);
  const started = course?.startRank != null;

  useEffect(() => {
    if (lang) rememberCourse(lang);
  }, [lang]);

  // The study session is likely next: start loading it now so it opens straight away.
  useEffect(() => {
    if (lang && started) prefetchSession(lang);
  }, [lang, started]);

  if (!lang) return <Navigate to="/" replace />;

  async function startFromBeginning() {
    setCached(courseKey(lang!), await courses.startFromBeginning(lang!));
    navigate(`/${lang}/study`, { viewTransition: true });
  }

  async function chooseLevel(level: Level) {
    setCached(courseKey(lang!), await courses.level(lang!, level));
  }

  return (
    <div className="page">
      <NavBar />
      <h1 className="large-title">{LANGUAGE_NAMES[lang]}</h1>
      {course?.estSize != null && <p className="muted">{t.estimate(course.estSize)}</p>}

      {error && !course ? (
        <p className="error">{t.somethingWrong}</p>
      ) : !course ? (
        <CourseSkeleton />
      ) : course.totalWords === 0 ? (
        <p className="empty">{t.noWordsYet}</p>
      ) : course.level === null ? (
        <section className="question__actions">
          <h2 className="group-label">{t.levelQuestion(LANGUAGE_NAMES[lang])}</h2>
          <LevelPicker value={null} onChange={(l) => void chooseLevel(l)} />
          <p className="group-hint">{t.levelHint}</p>
        </section>
      ) : (
        <>
          <div className="stats">
            <Stat value={course.known} label={t.known} />
            <Stat value={course.learning} label={t.learning} />
            <Stat value={course.recovered} label={t.recovered} />
          </div>

          {!started ? (
            <section className="question__actions">
              <p className="muted">{t.findLevelHint}</p>
              <Link to={`/${lang}/assessment`} className="button-link button--primary" viewTransition>
                {t.findLevel}
              </Link>
              <button type="button" className="button--plain" onClick={() => void startFromBeginning()}>
                {t.startFromBeginning}
              </button>
            </section>
          ) : (
            <ul className="rows" style={{ "--inset": "2.6rem" } as CSSProperties}>
              <RowLink to={`/${lang}/study`} icon={BookOpen} title={t.study} subtitle={t.studySubtitle(course.due, course.learning)} />
              <RowLink to={`/${lang}/words`} icon={List} title={t.words} meta={t.wordsCount(course.known + course.learning)} />
              <RowLink to={`/${lang}/assessment`} icon={Gauge} title={t.retakeAssessment} />
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function CourseSkeleton() {
  return (
    <div className="question" aria-busy="true" aria-label={t.loading}>
      <div className="skeleton skeleton--stats" />
      <div className="skeleton skeleton--block" />
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
      <Link to={props.to} className="row row--link" viewTransition>
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
