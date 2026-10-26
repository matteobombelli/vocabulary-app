// Every UI string lives here, so a French interface can be added by swapping this module.
import type { AnswerLang, Lang, Verdict } from "../shared/api";

export const LANGUAGE_NAMES: Record<Lang, string> = { en: "English", fr: "Français" };

export const ANSWER_LANG_NAMES: Record<AnswerLang, string> = { en: "English", fr: "French", either: "English or French" };

export const VERDICT_LABELS: Record<Verdict, string> = {
  correct: "Correct",
  partial: "Partly right",
  incorrect: "Not quite",
};

export const t = {
  appName: "Vocabulary",
  logOut: "Log out",
  loading: "Loading",
  somethingWrong: "Something went wrong. Try again.",
  back: "Back",

  // Home and course
  coursesTitle: "Your courses",
  known: "known",
  learning: "learning",
  due: "due for review",
  estimate: (n: number) => `About ${n.toLocaleString()} words`,
  notAssessed: "Not assessed yet",
  findLevel: "Find your level",
  findLevelHint: "About 50 quick questions to estimate your vocabulary and pick where to start.",
  retakeAssessment: "Retake the assessment",
  startFromBeginning: "Start from the most common words",
  learn: "Learn new words",
  review: (n: number) => (n > 0 ? `Review ${n} due` : "Nothing due for review"),
  words: "Your words",
  settings: "Settings",
  startsAt: (rank: number) => `Learning from word #${rank.toLocaleString()}`,
  noWordsYet: "This language's word list is not loaded yet.",

  // Questions
  whatDoesItMean: "What does it mean?",
  typeDefinition: "Type a short definition",
  answerIn: (lang: string) => `Answer in ${lang}.`,
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
    "Press \"I don't know\" rather than guessing: a guess makes the estimate worse, not better.",
  ],
  begin: "Begin",
  questionOf: (i: number, n: number) => `${i} of ${n}`,
  resultTitle: "Your result",
  resultSize: (n: number, total: number) => `You know about ${n.toLocaleString()} of the ${total.toLocaleString()} words in this list.`,
  resultStart: (rank: number) => `Learning will start around word #${rank.toLocaleString()}.`,
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
  settingsTitle: "Settings",
  showDefinitionsIn: "Show definitions in",
  acceptAnswersIn: "Accept typed answers in",
  englishOnly: "The English course uses English definitions and answers.",
  saved: "Saved",

  // Auth
  logIn: "Log in",
  register: "Register",

  attribution: "Word data: Open English WordNet, Lexique 3, and Wiktionary via kaikki.org (CC BY-SA).",
};
