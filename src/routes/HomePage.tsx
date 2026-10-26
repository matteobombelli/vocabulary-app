import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { Course } from "../../shared/api";
import { courses as coursesApi } from "../api/endpoints";
import { Spinner } from "../components/Spinner";
import { LANGUAGE_NAMES, t } from "../strings";

export default function HomePage() {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    coursesApi.list().then(setCourses, () => setError(true));
  }, []);

  if (error) return <p className="text-bad">{t.somethingWrong}</p>;
  if (!courses) return <Spinner />;

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t.coursesTitle}</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {courses.map((c) => (
          <Link key={c.lang} to={`/${c.lang}`} className="card block text-fg no-underline transition-colors hover:border-accent">
            <h2 className="text-xl font-semibold">{LANGUAGE_NAMES[c.lang]}</h2>
            <p className="mt-1 text-sm text-muted">{c.estSize !== null ? t.estimate(c.estSize) : t.notAssessed}</p>
            <p className="mt-4 text-sm">
              <span className="font-semibold">{c.known.toLocaleString()}</span> {t.known} ·{" "}
              <span className="font-semibold">{c.learning.toLocaleString()}</span> {t.learning}
              {c.due > 0 && (
                <>
                  {" "}
                  · <span className="font-semibold text-accent">{c.due}</span> {t.due}
                </>
              )}
            </p>
          </Link>
        ))}
      </div>
    </>
  );
}
