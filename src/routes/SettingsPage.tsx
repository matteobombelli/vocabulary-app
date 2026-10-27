import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { DEF_LANGS, type AnswerLang, type Course, type Lang, type Level } from "../../shared/api";
import { courseKey, setCached } from "../api/cache";
import { courses as coursesApi } from "../api/endpoints";
import { useAuth } from "../auth/AuthProvider";
import { NavBar } from "../components/NavBar";
import { LevelPicker } from "../components/LevelPicker";
import { Segmented } from "../components/Segmented";
import { Spinner } from "../components/Spinner";
import { lastCourse } from "../lastCourse";
import { ANSWER_LANG_NAMES, LANGUAGE_NAMES, t } from "../strings";

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    coursesApi.list().then(setCourses, () => setError(true));
  }, []);

  async function update(lang: Lang, request: Promise<Course>) {
    try {
      const updated = await request;
      setCached(courseKey(lang), updated);
      setCourses((cs) => cs?.map((c) => (c.lang === lang ? updated : c)) ?? null);
    } catch {
      setError(true);
    }
  }

  const save = (lang: Lang, defLang: Lang, answerLang: AnswerLang) => update(lang, coursesApi.settings(lang, { defLang, answerLang }));
  const saveLevel = (lang: Lang, level: Level) => update(lang, coursesApi.level(lang, level));

  // Leave the page first: signing out here would otherwise send the login redirect back to Settings.
  async function onLogout() {
    navigate("/login", { replace: true });
    await logout();
  }

  const back = lastCourse();

  return (
    <div className="page">
      <NavBar back={{ to: `/${back}`, label: LANGUAGE_NAMES[back] }} />
      <h1 className="large-title">{t.settings}</h1>
      {error && <p className="error">{t.somethingWrong}</p>}
      {!courses ? (
        <Spinner />
      ) : (
        courses.map((c) => {
          const defLangs = DEF_LANGS[c.lang];
          const level = (
            <div>
              <h3 className="group-label">{t.level}</h3>
              <LevelPicker value={c.level} onChange={(l) => void saveLevel(c.lang, l)} />
            </div>
          );
          if (defLangs.length === 1) {
            return (
              <section key={c.lang} className="settings-course">
                <h2 className="group-label group-label--course">{LANGUAGE_NAMES[c.lang]}</h2>
                {level}
                <p className="group-hint">{t.englishOnly}</p>
              </section>
            );
          }
          const answerLangs: AnswerLang[] = [...defLangs, "either"];
          return (
            <section key={c.lang} className="settings-course">
              <h2 className="group-label group-label--course">{LANGUAGE_NAMES[c.lang]}</h2>
              {level}
              <div className="group">
                <div className="group__row">
                  <span className="group__name">{t.definitionsIn}</span>
                  <Segmented
                    label={t.definitionsIn}
                    options={defLangs.map((l) => ({ value: l, label: ANSWER_LANG_NAMES[l] }))}
                    value={c.defLang}
                    onChange={(v) => void save(c.lang, v, c.answerLang)}
                  />
                </div>
                <div className="group__row">
                  <span className="group__name">{t.answersIn}</span>
                  <Segmented
                    label={t.answersIn}
                    options={answerLangs.map((l) => ({ value: l, label: ANSWER_LANG_NAMES[l] }))}
                    value={c.answerLang}
                    onChange={(v) => void save(c.lang, c.defLang, v)}
                  />
                </div>
              </div>
              <p className="group-hint">{t.frenchHint}</p>
            </section>
          );
        })
      )}

      <section>
        <h2 className="group-label">{t.account}</h2>
        <div className="group">
          <div className="group__row">
            <span className="group__name">{user?.email}</span>
          </div>
          <button type="button" className="group__button group__button--danger" onClick={() => void onLogout()}>
            {t.logOut}
          </button>
        </div>
      </section>

      <section>
        <h2 className="group-label">{t.about}</h2>
        <p className="group-hint">{t.attribution}</p>
      </section>
    </div>
  );
}
