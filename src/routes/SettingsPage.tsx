import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { AnswerLang, DEF_LANGS, type Course, type Lang } from "../../shared/api";
import { courses } from "../api/endpoints";
import { PageHeader } from "../components/PageHeader";
import { Spinner } from "../components/Spinner";
import { ANSWER_LANG_NAMES, LANGUAGE_NAMES, t } from "../strings";
import { useLang } from "../useLang";

export default function SettingsPage() {
  const lang = useLang();
  const [course, setCourse] = useState<Course | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (lang) courses.get(lang).then(setCourse, () => setError(true));
  }, [lang]);

  if (!lang) return <Navigate to="/" replace />;
  if (error) return <p className="text-bad">{t.somethingWrong}</p>;
  if (!course) return <Spinner />;

  const defLangs = DEF_LANGS[lang];
  const answerLangs: AnswerLang[] = [...defLangs, ...(defLangs.length > 1 ? (["either"] as const) : [])];

  async function save(defLang: Lang, answerLang: AnswerLang) {
    setSaved(false);
    try {
      setCourse(await courses.settings(lang!, { defLang, answerLang }));
      setSaved(true);
    } catch {
      setError(true);
    }
  }

  return (
    <>
      <PageHeader title={`${t.settingsTitle} · ${LANGUAGE_NAMES[lang]}`} back={`/${lang}`}>
        {saved && <span className="text-sm text-good">{t.saved}</span>}
      </PageHeader>
      {defLangs.length === 1 ? (
        <p className="text-muted">{t.englishOnly}</p>
      ) : (
        <div className="card space-y-6">
          <Choice
            legend={t.showDefinitionsIn}
            name="defLang"
            options={defLangs.map((l) => ({ value: l, label: ANSWER_LANG_NAMES[l] }))}
            value={course.defLang}
            onChange={(v) => void save(v as Lang, course.answerLang)}
          />
          <Choice
            legend={t.acceptAnswersIn}
            name="answerLang"
            options={answerLangs.map((l) => ({ value: l, label: ANSWER_LANG_NAMES[l] }))}
            value={course.answerLang}
            onChange={(v) => void save(course.defLang, v as AnswerLang)}
          />
        </div>
      )}
    </>
  );
}

function Choice(props: {
  legend: string;
  name: string;
  options: { value: string; label: string }[];
  value: string;
  onChange(value: string): void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 font-medium">{props.legend}</legend>
      <div className="flex flex-wrap gap-2">
        {props.options.map((o) => (
          <label key={o.value} className={`btn cursor-pointer ${props.value === o.value ? "btn-primary" : ""}`}>
            <input
              type="radio"
              className="sr-only"
              name={props.name}
              value={o.value}
              checked={props.value === o.value}
              onChange={() => props.onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
