import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, Navigate } from "react-router";
import type { AnswerResult, Lang, LevelChange, SessionWord, StudyAnswer, StudyAnswerResponse, Verdict } from "../../shared/api";
import {
  answerKind,
  applyResults,
  clozeMatches,
  createEngine,
  firstSight,
  nextItem,
  progress,
  sessionWord,
  type Engine,
  type Item,
  type Result,
} from "../../shared/session";
import { ApiError } from "../api/client";
import { courseKey, dropSession, prefetchSession, setCached, takeSession } from "../api/cache";
import { courses, study } from "../api/endpoints";
import { ChoiceOnlyBanner } from "../components/ChoiceOnlyBanner";
import { ChoiceGame } from "../components/games/ChoiceGame";
import { Feedback } from "../components/games/Feedback";
import { MatchGame } from "../components/games/MatchGame";
import { TypedGame } from "../components/games/TypedGame";
import { NavBar } from "../components/NavBar";
import { LANGUAGE_NAMES, t } from "../strings";
import { useLang } from "../useLang";

const RETRIES = 2;

/**
 * Posts answers one after another (a word's answers must land in order), retrying network
 * failures. Answers checked on the client are fire-and-forget; typed ones await the grader.
 */
function useAnswerQueue(lang: Lang | null, onResponse: (r: StudyAnswerResponse) => void, onFailure: () => void) {
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const push = useCallback(
    (body: StudyAnswer): Promise<StudyAnswerResponse> => {
      const send = async (attempt: number): Promise<StudyAnswerResponse> => {
        try {
          const r = await study.answer(lang!, body);
          onResponse(r);
          return r;
        } catch (err) {
          if (!(err instanceof ApiError) && attempt < RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
            return send(attempt + 1);
          }
          if (body.kind !== "typed") onFailure();
          throw err;
        }
      };
      const p = chain.current.then(() => send(0));
      chain.current = p.catch(() => undefined);
      return p;
    },
    [lang, onResponse, onFailure],
  );
  const flush = useCallback(() => chain.current, []);
  return useMemo(() => ({ push, flush }), [push, flush]);
}

interface Answered {
  verdict: Verdict;
  // ChoiceGame's pick (null: "I don't know").
  picked?: string | null;
  result?: AnswerResult;
  answer?: ReactNode;
  words: SessionWord[];
  teach: boolean;
  auto: boolean;
}

function label(engine: Engine, item: Item, word: SessionWord | null): string {
  if (item.kind === "mc" && item.stage === "intro") return firstSight(engine, item.wordId) ? t.newWord : t.again;
  if (item.kind === "define" && word?.decayed) return t.refresh;
  return t.labels[item.kind === "match" ? item.game : item.kind];
}

function Blank({ sentence, fill }: { sentence: string; fill?: string }) {
  const [before, after] = sentence.split("___");
  return (
    <p className="cloze">
      {before}
      <span className={fill ? "cloze__fill" : "cloze__blank"}>{fill ?? " ".repeat(8)}</span>
      {after}
    </p>
  );
}

export default function StudyPage() {
  const lang = useLang();
  const [engine, setEngine] = useState<Engine | null>(null);
  const [item, setItem] = useState<Item | null>(null);
  // Fixed when the item is shown: answering changes the engine, not what the card was.
  const [itemLabel, setItemLabel] = useState("");
  const [answered, setAnswered] = useState<Answered | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [turn, setTurn] = useState(0);

  const onResponse = useCallback((r: StudyAnswerResponse) => {
    const change: LevelChange = r.levelChange;
    if (change) setToast(change === "up" ? t.levelUp : t.levelDown);
  }, []);
  const onFailure = useCallback(() => setToast(t.saveFailed), []);
  const queue = useAnswerQueue(lang, onResponse, onFailure);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Only the latest load may set the session (StrictMode mounts twice; "Keep going" reloads).
  const loads = useRef(0);
  const load = useCallback(async () => {
    if (!lang) return;
    const id = ++loads.current;
    setError(null);
    setEngine(null);
    setItem(null);
    setAnswered(null);
    try {
      await queue.flush();
      const s = await takeSession(lang);
      if (id !== loads.current) return;
      const e = createEngine(s.words, s.known, s.level, s.status.choiceOnly);
      setEngine(e);
      show(e);
      setAnswered(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.somethingWrong);
    }
  }, [lang, queue]);

  useEffect(() => {
    void load();
    return () => {
      if (lang) dropSession(lang);
    };
  }, [load, lang]);

  // The session is over: once its answers are saved, refresh the course and fetch the next one.
  const over = engine !== null && item === null;
  useEffect(() => {
    if (!over || !lang) return;
    void queue.flush().then(() => {
      prefetchSession(lang);
      courses.get(lang).then((c) => setCached(courseKey(lang), c), () => undefined);
    });
  }, [over, lang, queue]);

  const word = engine && item && item.kind !== "match" ? sessionWord(engine, item.wordId) : null;

  function show(e: Engine) {
    const next = nextItem(e);
    setItem(next);
    if (next) setItemLabel(label(e, next, next.kind === "match" ? null : sessionWord(e, next.wordId)));
  }

  /** Records answers checked on the client and shows how it went. */
  function finish(results: Result[], bodies: StudyAnswer[], shown: Omit<Answered, "verdict" | "auto" | "words"> & { words?: SessionWord[] }) {
    if (!engine || !item) return;
    for (const b of bodies) queue.push(b).catch(() => undefined);
    const allRight = results.every((r) => r.correct);
    const missed = results.filter((r) => !r.correct).map((r) => sessionWord(engine, r.wordId));
    setEngine(applyResults(engine, item, results));
    setAnswered({
      verdict: allRight ? "correct" : "incorrect",
      ...shown,
      words: shown.words ?? (allRight ? results.map((r) => sessionWord(engine, r.wordId)) : missed),
      auto: allRight && !shown.teach,
    });
  }

  /** A typed definition or sentence: waits for the grader. */
  async function grade(text: string | null) {
    if (!engine || !item || item.kind === "match" || !word) return;
    const { stage, game } = answerKind(item);
    setChecking(true);
    setError(null);
    try {
      const { result } = await queue.push({
        wordId: word.wordId,
        stage,
        game,
        kind: text === null ? "dontknow" : "typed",
        answer: text ?? undefined,
      });
      const correct = result.verdict === "correct";
      setEngine(applyResults(engine, item, [{ wordId: word.wordId, correct }]));
      setAnswered({ verdict: result.verdict, result, words: [word], teach: !correct || item.kind === "define", auto: false });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Grading paused mid-session: carry on with multiple choice.
        const e = { ...engine, choiceOnly: true };
        setEngine(e);
        show(e);
      }
      setError(err instanceof ApiError ? err.message : t.somethingWrong);
    } finally {
      setChecking(false);
    }
  }

  function pick(option: string | null) {
    if (!item || !word || answered) return;
    const { stage, game } = answerKind(item);
    const body = (correct: boolean): StudyAnswer => ({
      wordId: word.wordId,
      stage,
      game,
      kind: option === null ? "dontknow" : "choice",
      answer: option ?? undefined,
      correct,
    });
    if (item.kind === "usage") {
      const correct = option === word.games.usage!.correct;
      finish([{ wordId: word.wordId, correct }], [body(correct)], { picked: option, teach: false, answer: correct ? undefined : word.games.usage!.correct });
    } else if (item.kind === "cloze") {
      const cloze = word.games.cloze!;
      const correct = option === cloze.answer;
      finish([{ wordId: word.wordId, correct }], [body(correct)], {
        picked: option,
        teach: false,
        answer: correct ? undefined : <Blank sentence={cloze.sentence} fill={cloze.answer} />,
      });
    } else {
      const correct = option === word.definition;
      const intro = item.kind === "mc" && item.stage === "intro";
      finish([{ wordId: word.wordId, correct }], [body(correct)], { picked: option, teach: intro || !correct, words: [word] });
    }
  }

  function typedCloze(text: string | null) {
    if (!item || !word || answered) return;
    const cloze = word.games.cloze!;
    const correct = text !== null && clozeMatches(text, cloze.answer, word.lemma);
    finish(
      [{ wordId: word.wordId, correct }],
      [{ wordId: word.wordId, stage: "games", game: "cloze", kind: text === null ? "dontknow" : "typed", answer: text ?? undefined }],
      { teach: false, answer: <Blank sentence={cloze.sentence} fill={cloze.answer} />, words: [word] },
    );
  }

  const onBoardDone = useCallback(
    (missed: Set<number>) => {
      if (!item || item.kind !== "match") return;
      const results = item.targets.map((wordId) => ({ wordId, correct: !missed.has(wordId) }));
      finish(
        results,
        results.map((r) => ({ wordId: r.wordId, stage: "games", game: item.game, kind: "match", correct: r.correct })),
        { teach: false },
      );
    },
    // finish reads the current engine and item, which change only between items.
    [item, engine],
  );

  const onContinue = useCallback(() => {
    if (!engine) return;
    setAnswered(null);
    setError(null);
    show(engine);
    setTurn((n) => n + 1);
  }, [engine]);

  if (!lang) return <Navigate to="/" replace />;
  const p = engine ? progress(engine) : null;

  return (
    <div className="page page--study">
      <NavBar back={{ to: `/${lang}`, label: LANGUAGE_NAMES[lang] }} />
      {p && item && (
        <div className="progress" role="progressbar" aria-valuenow={p.done} aria-valuemax={p.done + p.left}>
          <div className="progress__bar" style={{ width: `${(p.done / Math.max(1, p.done + p.left)) * 100}%` }} />
        </div>
      )}
      {engine?.choiceOnly && <ChoiceOnlyBanner status={{ choiceOnly: true, reason: null, gradedToday: 0, dailyCap: 0 }} />}
      {error && <p className="error">{error}</p>}

      {!engine ? (
        !error && <SkeletonCard />
      ) : !item ? (
        <Summary engine={engine} lang={lang} onMore={() => void load()} />
      ) : (
        <div className="question card-enter" key={turn}>
          <div>
            <p className="question__label">{itemLabel}</p>
            {word && item.kind !== "cloze" && (
              <>
                <h2 className="lemma">{word.lemma}</h2>
                <p className="lemma__pos">{word.pos.split(",").join(", ")}</p>
              </>
            )}
          </div>
          <ItemBody
            item={item}
            word={word}
            answered={answered}
            checking={checking}
            lang={lang}
            onPick={pick}
            onTyped={(text) => (item.kind === "cloze" ? typedCloze(text) : void grade(text))}
            onBoardDone={onBoardDone}
          />
          {answered && (
            <Feedback
              verdict={answered.verdict}
              feedback={answered.result?.feedback}
              answer={answered.answer}
              words={answered.words}
              teach={answered.teach}
              auto={answered.auto}
              onContinue={onContinue}
            />
          )}
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}

interface BodyProps {
  item: Item;
  word: SessionWord | null;
  answered: Answered | null;
  checking: boolean;
  lang: Lang;
  onPick(option: string | null): void;
  onTyped(text: string | null): void;
  onBoardDone(missed: Set<number>): void;
}

function ItemBody({ item, word, answered, checking, lang, onPick, onTyped, onBoardDone }: BodyProps) {
  const picked = answered ? answered.picked : undefined;
  switch (item.kind) {
    case "mc":
      return <ChoiceGame label={t.whatDoesItMean} options={item.options} correct={word!.definition} picked={picked} onPick={onPick} />;
    case "usage":
      return <ChoiceGame label={t.whichUsage} options={item.options} correct={word!.games.usage!.correct} picked={picked} onPick={onPick} />;
    case "cloze": {
      const cloze = word!.games.cloze!;
      return (
        <>
          <Blank sentence={cloze.sentence} />
          {item.typed ? (
            <TypedGame
              label={t.typeBlank}
              placeholder={t.typeBlank}
              hint={`${t.hint}: ${word!.definition}`}
              checking={false}
              answered={answered !== null}
              onSubmit={onTyped}
            />
          ) : (
            <ChoiceGame label={t.pickBlank} options={item.options} correct={cloze.answer} picked={picked} onPick={onPick} />
          )}
        </>
      );
    }
    case "sentence":
      return (
        <TypedGame
          label={t.writeSentence}
          placeholder={t.writeSentence}
          hint={t.sentenceIn(LANGUAGE_NAMES[lang])}
          multiline
          checking={checking}
          answered={answered !== null}
          onSubmit={onTyped}
        />
      );
    case "define":
      return item.typed ? (
        <TypedGame
          label={t.whatDoesItMean}
          placeholder={t.typeDefinition}
          checking={checking}
          answered={answered !== null}
          onSubmit={onTyped}
        />
      ) : (
        <ChoiceGame label={t.whatDoesItMean} options={item.options} correct={word!.definition} picked={picked} onPick={onPick} />
      );
    case "match":
      return (
        <>
          <p className="muted">{t.matchHint}</p>
          <MatchGame pairs={item.pairs} rights={item.rights} onDone={onBoardDone} />
        </>
      );
  }
}

function SkeletonCard() {
  return (
    <div className="question" aria-busy="true" aria-label={t.loading}>
      <div className="skeleton skeleton--label" />
      <div className="skeleton skeleton--title" />
      <div className="skeleton skeleton--block" />
    </div>
  );
}

function Summary({ engine, lang, onMore }: { engine: Engine; lang: Lang; onMore(): void }) {
  const s = engine.stats;
  if (s.answered === 0) {
    return (
      <div className="question">
        <h1 className="large-title">{t.studyTitle}</h1>
        <p>{t.nothingToStudy}</p>
        <Link to={`/${lang}`} className="button-link button--plain">
          {t.back}
        </Link>
      </div>
    );
  }
  const tiles: [string, number][] = [
    [t.summary.introduced, s.introduced],
    [t.summary.gamesWon, s.gamesWon],
    [t.summary.completed, s.completed],
    [t.summary.recovered, s.recovered],
  ];
  return (
    <div className="question summary">
      <h1 className="large-title">{t.sessionDone}</h1>
      <p className="muted">{t.sessionSummary(s.right, s.answered)}</p>
      <div className="summary__grid">
        {tiles.map(([name, n], i) => (
          <div key={name} className="summary__tile" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="stats__value">{n}</div>
            <div className="stats__label">{name}</div>
          </div>
        ))}
      </div>
      <div className="question__actions">
        <button type="button" className="button--primary" onClick={onMore}>
          {t.keepGoing}
        </button>
        <Link to={`/${lang}`} className="button-link button--plain">
          {t.back}
        </Link>
      </div>
    </div>
  );
}
