import type {
  Answer,
  AnswerResult,
  AssessmentAnswerResponse,
  AssessmentStep,
  Card,
  Course,
  CourseSettings,
  Lang,
  LoginBody,
  RegisterBody,
  Status,
  StudyAnswer,
  User,
  WordListItem,
} from "../../shared/api";
import { api } from "./client";

export const auth = {
  me: () => api<{ user: User }>("/auth/me").then((r) => r.user),
  login: (body: LoginBody) => api<{ user: User }>("/auth/login", { body }).then((r) => r.user),
  register: (body: RegisterBody) => api<{ user: User }>("/auth/register", { body }).then((r) => r.user),
  logout: () => api<void>("/auth/logout", { method: "POST" }),
};

export const status = () => api<{ status: Status }>("/status").then((r) => r.status);

export const courses = {
  list: () => api<{ courses: Course[] }>("/courses").then((r) => r.courses),
  get: (lang: Lang) => api<{ course: Course }>(`/courses/${lang}`).then((r) => r.course),
  settings: (lang: Lang, body: CourseSettings) =>
    api<{ course: Course }>(`/courses/${lang}/settings`, { method: "PUT", body }).then((r) => r.course),
  startFromBeginning: (lang: Lang) =>
    api<{ course: Course }>(`/courses/${lang}/start-from-beginning`, { method: "POST" }).then((r) => r.course),
};

export const assessment = {
  start: (lang: Lang) => api<{ step: AssessmentStep }>(`/courses/${lang}/assessment`, { method: "POST" }).then((r) => r.step),
  answer: (lang: Lang, id: string, body: Answer) =>
    api<AssessmentAnswerResponse>(`/courses/${lang}/assessment/${id}/answer`, { body }),
};

export const study = {
  learn: (lang: Lang) => api<{ cards: Card[] }>(`/courses/${lang}/learn`).then((r) => r.cards),
  review: (lang: Lang) => api<{ cards: Card[] }>(`/courses/${lang}/review`).then((r) => r.cards),
  answer: (lang: Lang, body: StudyAnswer) =>
    api<{ result: AnswerResult }>(`/courses/${lang}/answer`, { body }).then((r) => r.result),
  words: (lang: Lang, status: "known" | "learning", offset: number) =>
    api<{ words: WordListItem[]; hasMore: boolean }>(`/courses/${lang}/words?status=${status}&offset=${offset}`),
};
