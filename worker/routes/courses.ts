import { CourseSettings, DEF_LANGS, LANGS, LevelBody } from "../../shared/api";
import { requireUser } from "../auth/session";
import { getCourse, parseLang, toCourse } from "../db";
import { json, parseJson } from "../http";
import { HttpError, type Router } from "../router";
import { gradingStatus } from "../services/budget";

export function registerCourseRoutes(r: Router): void {
  r.get("/status", async (c) => {
    const user = await requireUser(c);
    return json({ status: await gradingStatus(c.env, user.id) });
  });

  r.get("/courses", async (c) => {
    const user = await requireUser(c);
    const courses = await Promise.all(LANGS.map(async (lang) => toCourse(c.env.DB, await getCourse(c.env.DB, user.id, lang))));
    return json({ courses });
  });

  r.get("/courses/:lang", async (c) => {
    const user = await requireUser(c);
    const course = await getCourse(c.env.DB, user.id, parseLang(c.params.lang));
    return json({ course: await toCourse(c.env.DB, course) });
  });

  r.put("/courses/:lang/settings", async (c) => {
    const user = await requireUser(c);
    const lang = parseLang(c.params.lang);
    const body = await parseJson(c.req, CourseSettings);
    const offered = DEF_LANGS[lang];
    if (!offered.includes(body.defLang)) throw new HttpError(400, "Definition language not offered");
    if (body.answerLang !== "either" && !offered.includes(body.answerLang)) throw new HttpError(400, "Answer language not offered");
    await getCourse(c.env.DB, user.id, lang);
    await c.env.DB.prepare("UPDATE courses SET def_lang = ?, answer_lang = ? WHERE user_id = ? AND lang = ?")
      .bind(body.defLang, body.answerLang, user.id, lang)
      .run();
    return json({ course: await toCourse(c.env.DB, await getCourse(c.env.DB, user.id, lang)) });
  });

  r.put("/courses/:lang/level", async (c) => {
    const user = await requireUser(c);
    const lang = parseLang(c.params.lang);
    const { level } = await parseJson(c.req, LevelBody);
    await getCourse(c.env.DB, user.id, lang);
    await c.env.DB.prepare("UPDATE courses SET level = ? WHERE user_id = ? AND lang = ?").bind(level, user.id, lang).run();
    return json({ course: await toCourse(c.env.DB, await getCourse(c.env.DB, user.id, lang)) });
  });

  // Starts learning from the most frequent words, without an assessment.
  r.post("/courses/:lang/start-from-beginning", async (c) => {
    const user = await requireUser(c);
    const lang = parseLang(c.params.lang);
    await getCourse(c.env.DB, user.id, lang);
    await c.env.DB.prepare("UPDATE courses SET start_rank = 1, cursor_rank = 0, adapt_right = 0, adapt_total = 0 WHERE user_id = ? AND lang = ?")
      .bind(user.id, lang)
      .run();
    return json({ course: await toCourse(c.env.DB, await getCourse(c.env.DB, user.id, lang)) });
  });
}
