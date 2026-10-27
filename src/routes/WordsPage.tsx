import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router";
import type { WordListItem, WordListTab } from "../../shared/api";
import { study } from "../api/endpoints";
import { NavBar } from "../components/NavBar";
import { Segmented } from "../components/Segmented";
import { LANGUAGE_NAMES, t } from "../strings";
import { useLang } from "../useLang";

type Tab = WordListTab;

function meta(w: WordListItem, tab: Tab): string {
  const date = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (tab === "recovered") return t.missed(w.failCount);
  if (w.decayed) return t.stageRefresh;
  if (w.stage === "intro") return t.stageIntro;
  if (w.stage === "games") return t.stageGames(w.gamesDone, w.gamesNeeded);
  if (w.stage === "define") return t.stageDefine;
  return w.dueAt !== null ? t.refreshOn(date(w.dueAt)) : `#${w.rank.toLocaleString()}`;
}

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
          { value: "recovered", label: t.recoveredTab },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "recovered" && <p className="group-hint">{t.recoveredHint}</p>}
      {error && <p className="error">{t.somethingWrong}</p>}
      {!words ? (
        <div className="skeleton skeleton--block" aria-busy="true" aria-label={t.loading} />
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
                <span className={`row__meta${tab === "learning" ? " chip" : ""}`}>{meta(w, tab)}</span>
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
