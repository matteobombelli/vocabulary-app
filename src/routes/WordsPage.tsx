import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router";
import type { WordListItem } from "../../shared/api";
import { study } from "../api/endpoints";
import { PageHeader } from "../components/PageHeader";
import { Spinner } from "../components/Spinner";
import { t } from "../strings";
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
    <>
      <PageHeader title={t.wordsTitle} back={`/${lang}`} />
      <div className="mb-4 flex gap-2" role="tablist">
        {(["known", "learning"] as const).map((x) => (
          <button
            key={x}
            type="button"
            role="tab"
            aria-selected={tab === x}
            className={`btn ${tab === x ? "btn-primary" : ""}`}
            onClick={() => setTab(x)}
          >
            {x === "known" ? t.knownTab : t.learningTab}
          </button>
        ))}
      </div>
      {error && <p className="text-bad">{t.somethingWrong}</p>}
      {!words ? (
        <Spinner />
      ) : words.length === 0 ? (
        <p className="text-muted">{t.noWords}</p>
      ) : (
        <ul className="card divide-y divide-line p-0">
          {words.map((w) => (
            <li key={w.wordId} className="px-5 py-3">
              <div className="flex items-baseline gap-2">
                <span className="font-semibold">{w.lemma}</span>
                <span className="text-xs text-muted">#{w.rank.toLocaleString()}</span>
                {w.box !== null && w.box > 0 && (
                  <span className="ml-auto text-xs text-muted">
                    {t.box(w.box)}
                    {w.dueAt !== null && ` · ${t.dueOn(new Date(w.dueAt).toLocaleDateString())}`}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted">{w.definition}</p>
            </li>
          ))}
        </ul>
      )}
      {hasMore && words && (
        <button type="button" className="btn mt-4" onClick={() => void load(words.length)}>
          {t.loadMore}
        </button>
      )}
    </>
  );
}
