import type {
  Answer,
  AnswerResult,
  AssessmentAnswerResponse,
  AssessmentStep,
  Course,
  CourseSettings,
  Lang,
  LoginBody,
  RegisterBody,
  Status,
  Level,
  StudyAnswer,
  StudyAnswerResponse,
  StudySession,
  User,
  WordListItem,
  WordListTab,
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
  level: (lang: Lang, level: Level) =>
    api<{ course: Course }>(`/courses/${lang}/level`, { method: "PUT", body: { level } }).then((r) => r.course),
  startFromBeginning: (lang: Lang) =>
    api<{ course: Course }>(`/courses/${lang}/start-from-beginning`, { method: "POST" }).then((r) => r.course),
};

export const assessment = {
  start: (lang: Lang) => api<{ step: AssessmentStep }>(`/courses/${lang}/assessment`, { method: "POST" }).then((r) => r.step),
  answer: (lang: Lang, id: string, body: Answer) =>
    api<AssessmentAnswerResponse>(`/courses/${lang}/assessment/${id}/answer`, { body }),
};

export const study = {
  session: (lang: Lang) => api<{ session: StudySession }>(`/courses/${lang}/session`).then((r) => r.session),
  answer: (lang: Lang, body: StudyAnswer) => api<StudyAnswerResponse>(`/courses/${lang}/answer`, { body }),
  words: (lang: Lang, tab: WordListTab, offset: number) =>
    api<{ words: WordListItem[]; hasMore: boolean }>(`/courses/${lang}/words?status=${tab}&offset=${offset}`),
};
