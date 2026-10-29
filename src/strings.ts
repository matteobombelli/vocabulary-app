// Every UI string lives here, so a French interface can be added by swapping this module.
import type { AnswerLang, Lang, Level, Verdict } from "../shared/api";

export const LANGUAGE_NAMES: Record<Lang, string> = { en: "English", fr: "Français" };

export const ANSWER_LANG_NAMES: Record<AnswerLang, string> = { en: "English", fr: "French", either: "Either" };

export const VERDICT_LABELS: Record<Verdict, string> = {
  correct: "Correct",
  partial: "Partly right",
  incorrect: "Not quite",
};

export const LEVEL_NAMES: Record<Level, { title: string; hint: string }> = {
  beginner: { title: "Beginner", hint: "I know everyday basics. Common words only, with word banks." },
  intermediate: { title: "Intermediate", hint: "I get by in most situations. Common and useful words." },
  fluent: { title: "Fluent", hint: "I read and talk comfortably. Rarer and literary words too." },
  native: { title: "Native", hint: "It's my first language. Start further up the list." },
};

export const t = {
  appName: "Vocabulary",
  courses: "Courses",
  loading: "Loading",
  somethingWrong: "Something went wrong. Try again.",
  tryAgain: "Try again",
  back: "Back",
  newVersion: "New version available",
  reload: "Reload",
  offline: "You're offline. Answers need a connection.",

  // Course
  known: "Known",
  learning: "Learning",
  recovered: "Recovered",
  due: "Due",
  levelQuestion: (lang: string) => `How well do you know ${lang}?`,
  levelHint: "This sets which words you'll learn and how you practise them. You can change it in Settings.",
  study: "Study",
  studySubtitle: (due: number, learning: number) =>
    [due > 0 && `${due} to refresh`, learning > 0 && `${learning} in progress`].filter(Boolean).join(" · ") || "New words",
  estimate: (n: number) => `About ${n.toLocaleString()} words known`,
  findLevel: "Find your level",
  findLevelHint: "About 50 quick questions estimate your vocabulary and pick where to start.",
  retakeAssessment: "Retake the assessment",
  startFromBeginning: "Start from the most common words",
  words: "Your words",
  wordsCount: (n: number) => n.toLocaleString(),
  noWordsYet: "This language's word list is not loaded yet.",

  // Questions
  whatDoesItMean: "What does it mean?",
  typeDefinition: "Type a short definition",
  answerIn: (lang: AnswerLang) => (lang === "either" ? "Answer in English or French." : `Answer in ${ANSWER_LANG_NAMES[lang]}.`),
  submit: "Check",
  dontKnow: "I don't know",
  continue: "Continue",
  definition: "Definition",
  dictionary: "Dictionary",
  example: "Example",
  choiceOnly: {
    budget: "Typed answers are paused for the rest of the month (API budget). Questions are multiple choice for now.",
    daily_cap: "You've reached today's limit for typed answers. Questions are multiple choice until tomorrow.",
    unavailable: "Typed answers can't be graded right now. Questions are multiple choice for now.",
  },

  // Assessment
  assessmentTitle: "Find your level",
  assessmentIntro: [
    "You'll see about 50 words, from very common to rare. Pick the meaning, or type it when asked.",
    "Choose \"I don't know\" rather than guessing: a guess makes the estimate worse, not better.",
  ],
  begin: "Begin",
  questionOf: (i: number, n: number) => `${i} of ${n}`,
  resultTitle: "Your result",
  resultSize: (n: number, total: number) => `You know about ${n.toLocaleString()} of the ${total.toLocaleString()} words in this list.`,
  resultStart: (rank: number) => `Learning starts around word #${rank.toLocaleString()}.`,
  startLearning: "Start learning",

  // Study
  studyTitle: "Study",
  sessionDone: "Nice work",
  sessionSummary: (right: number, total: number) => `${right} of ${total} answers right.`,
  nothingToStudy: "Nothing to study right now. Words waiting to be defined come back in a few hours.",
  keepGoing: "Keep going",
  summary: {
    answered: "Answers",
    right: "Right",
    introduced: "New words",
    gamesWon: "Games won",
    completed: "Learned",
    recovered: "Comebacks",
  },
  newWord: "New word",
  again: "Again",
  refresh: "Refresh",
  boardWords: "Words",
  boardPartners: "Partners",
  matchRight: (left: string, right: string) => `${left} and ${right}: a match`,
  matchWrong: (left: string, right: string) => `${left} and ${right}: not a match`,
  labels: {
    usage: "Correct usage",
    cloze: "Fill in the blank",
    sentence: "Use it in a sentence",
    synonym: "Match the synonyms",
    antonym: "Match the opposites",
    define: "Define it",
    mc: "Meaning",
  },
  whichUsage: "Which sentence uses it correctly?",
  pickBlank: "Which word fits?",
  typeBlank: "Type the missing word",
  hint: "Meaning",
  writeSentence: "Write a sentence that uses it",
  sentenceIn: (lang: string) => `Write it in ${lang}.`,
  matchHint: "Tap a word, then its partner.",
  checking: "Checking…",
  rightAnswer: "Answer",
  levelUp: "You're flying — moving you to harder words.",
  levelDown: "Let's ease off — moving you to commoner words.",
  saveFailed: "Couldn't save an answer. Check your connection.",

  // Words
  wordsTitle: "Your words",
  knownTab: "Known",
  learningTab: "Learning",
  recoveredTab: "Recovered",
  recoveredHint: "Words you missed at some point and have learned since.",
  noWords: "No words here yet.",
  loadMore: "Load more",
  stageIntro: "New",
  stageGames: (done: number, needed: number) => `Games ${done}/${needed}`,
  stageDefine: "Define",
  stageRefresh: "Refresh",
  missed: (n: number) => `missed ${n}×`,
  refreshOn: (d: string) => `refresh ${d}`,

  // Settings
  settings: "Settings",
  level: "Level",
  definitionsIn: "Definitions",
  answersIn: "Typed answers",
  frenchHint: "Definitions and multiple-choice options show in this language. Typed answers are accepted in the language chosen below it.",
  englishOnly: "The English course uses English definitions and answers.",
  account: "Account",
  logOut: "Log out",
  about: "About",
  attribution: "Word data: Open English WordNet, Lexique 3, and Wiktionary via kaikki.org (CC BY-SA). Answers are graded by Claude.",

  // Auth
  logIn: "Log in",
  register: "Register",
};
