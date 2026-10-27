// Every UI string lives here, so a French interface can be added by swapping this module.
import type { AnswerLang, Lang, Verdict } from "../shared/api";

export const LANGUAGE_NAMES: Record<Lang, string> = { en: "English", fr: "Français" };

export const ANSWER_LANG_NAMES: Record<AnswerLang, string> = { en: "English", fr: "French", either: "Either" };

export const VERDICT_LABELS: Record<Verdict, string> = {
  correct: "Correct",
  partial: "Partly right",
  incorrect: "Not quite",
};

export const t = {
  appName: "Vocabulary",
  courses: "Courses",
  loading: "Loading",
  somethingWrong: "Something went wrong. Try again.",
  back: "Back",
  newVersion: "New version available",
  reload: "Reload",
  offline: "You're offline. Answers need a connection.",

  // Course
  known: "Known",
  learning: "Learning",
  due: "Due",
  estimate: (n: number) => `About ${n.toLocaleString()} words known`,
  findLevel: "Find your level",
  findLevelHint: "About 50 quick questions estimate your vocabulary and pick where to start.",
  retakeAssessment: "Retake the assessment",
  startFromBeginning: "Start from the most common words",
  learn: "Learn new words",
  learnFrom: (rank: number) => `From word #${rank.toLocaleString()}`,
  review: "Review",
  reviewDue: (n: number) => (n > 0 ? `${n} due` : "Nothing due"),
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
  learnTitle: "Learn",
  reviewTitle: "Review",
  sessionDone: "Session done",
  sessionSummary: (right: number, total: number) => `${right} of ${total} right the first time.`,
  nothingToReview: "Nothing is due. Come back later.",
  nothingToLearn: "You've reached the end of the list.",
  moreWords: "Next words",
  newWord: "New word",
  again: "Again",

  // Words
  wordsTitle: "Your words",
  knownTab: "Known",
  learningTab: "Learning",
  noWords: "No words here yet.",
  loadMore: "Load more",
  box: (n: number) => `Box ${n}`,
  dueOn: (d: string) => `due ${d}`,

  // Settings
  settings: "Settings",
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
