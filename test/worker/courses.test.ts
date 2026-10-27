import { beforeAll, describe, expect, it } from "vitest";
import { cookieHeader, jsonRequest, registerAndLogin, request, seedWords } from "./helpers";

let seq = 0;
const email = () => `courses${++seq}@example.com`;

beforeAll(async () => {
  await seedWords("en", 300);
  await seedWords("fr", 200);
});

describe("courses", () => {
  it("lists both courses with default settings", async () => {
    const { cookie } = await registerAndLogin(email());
    const res = await request("/courses", { headers: cookieHeader(cookie) });
    expect(res.status).toBe(200);
    const { courses } = (await res.json()) as { courses: Record<string, unknown>[] };
    expect(courses).toEqual([
      { lang: "en", defLang: "en", answerLang: "en", level: null, startRank: null, estSize: null, assessedAt: null, totalWords: 300, known: 0, learning: 0, recovered: 0, due: 0 },
      { lang: "fr", defLang: "fr", answerLang: "fr", level: null, startRank: null, estSize: null, assessedAt: null, totalWords: 200, known: 0, learning: 0, recovered: 0, due: 0 },
    ]);
  });

  it("requires a session", async () => {
    expect((await request("/courses")).status).toBe(401);
  });

  it("404s an unknown language", async () => {
    const { cookie } = await registerAndLogin(email());
    expect((await request("/courses/de", { headers: cookieHeader(cookie) })).status).toBe(404);
  });

  it("updates French settings", async () => {
    const { cookie } = await registerAndLogin(email());
    const res = await jsonRequest("/courses/fr/settings", "PUT", { defLang: "en", answerLang: "either" }, cookie);
    expect(res.status).toBe(200);
    const { course } = (await res.json()) as { course: { defLang: string; answerLang: string } };
    expect(course.defLang).toBe("en");
    expect(course.answerLang).toBe("either");
  });

  it("refuses French definitions on the English course", async () => {
    const { cookie } = await registerAndLogin(email());
    expect((await jsonRequest("/courses/en/settings", "PUT", { defLang: "fr", answerLang: "fr" }, cookie)).status).toBe(400);
    expect((await jsonRequest("/courses/en/settings", "PUT", { defLang: "en", answerLang: "fr" }, cookie)).status).toBe(400);
  });

  it("sets the level per course", async () => {
    const { cookie } = await registerAndLogin(email());
    const res = await jsonRequest("/courses/fr/level", "PUT", { level: "beginner" }, cookie);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { course: { level: string } }).course.level).toBe("beginner");
    const en = await request("/courses/en", { headers: cookieHeader(cookie) });
    expect(((await en.json()) as { course: { level: string | null } }).course.level).toBeNull();
    expect((await jsonRequest("/courses/fr/level", "PUT", { level: "expert" }, cookie)).status).toBe(400);
  });

  it("starts from the beginning without an assessment", async () => {
    const { cookie } = await registerAndLogin(email());
    const res = await request("/courses/en/start-from-beginning", { method: "POST", headers: cookieHeader(cookie) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { course: { startRank: number } }).course.startRank).toBe(1);
  });
});
