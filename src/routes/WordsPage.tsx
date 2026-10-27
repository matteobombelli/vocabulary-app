import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router";
import type { WordListItem } from "../../shared/api";
import { study } from "../api/endpoints";
import { NavBar } from "../components/NavBar";
import { Segmented } from "../components/Segmented";
import { Spinner } from "../components/Spinner";
import { LANGUAGE_NAMES, t } from "../strings";
import { useLang } from "../useLang";

type Tab = "known" | "learning";

export default function WordsPage() {
  const lang = useLang();
  const [tab, setTab] = useState<Tab>("known");
  const [words, setWords] = useState<WordListItem[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(
    async (offset: number) => {
      try {
        const page = await study.words(lang!, tab, offset);
        setWords((prev) => (offset === 0 ? page.words : [...(prev ?? []), ...page.words]));
        setHasMore(page.hasMore);
      } catch {
        setError(true);
      }
    },
    [lang, tab]
  );

  useEffect(() => {
    if (!lang) return;
    setWords(null);
    void load(0);
  }, [lang, load]);

  if (!lang) return <Navigate to="/" replace />;

  return (
    <div className="page">
      <NavBar back={{ to: `/${lang}`, label: LANGUAGE_NAMES[lang] }} />
      <h1 className="large-title">{t.wordsTitle}</h1>
      <Segmented<Tab>
        label={t.wordsTitle}
        options={[
          { value: "known", label: t.knownTab },
          { value: "learning", label: t.learningTab },
        ]}
        value={tab}
        onChange={setTab}
      />
      {error && <p className="error">{t.somethingWrong}</p>}
      {!words ? (
        <Spinner />
      ) : words.length === 0 ? (
        <p className="empty">{t.noWords}</p>
      ) : (
        <ul className="rows">
          {words.map((w) => (
            <li key={w.wordId}>
              <div className="row">
                <span className="row__body">
                  <span className="row__title">{w.lemma}</span>
                  <span className="row__subtitle">{w.definition}</span>
                </span>
                <span className="row__meta">
                  {w.box !== null && w.box > 0 && w.dueAt !== null
                    ? t.dueOn(new Date(w.dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }))
                    : `#${w.rank.toLocaleString()}`}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {hasMore && words && (
        <button type="button" onClick={() => void load(words.length)}>
          {t.loadMore}
        </button>
      )}
    </div>
  );
}
