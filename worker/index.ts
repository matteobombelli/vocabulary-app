import { API_PREFIX } from "../shared/api";
import { json } from "./http";
import { registerAssessmentRoutes } from "./routes/assessment";
import { registerAuthRoutes } from "./routes/auth";
import { registerCourseRoutes } from "./routes/courses";
import { registerStudyRoutes } from "./routes/study";
import { Router } from "./router";

const router = new Router();

router.get("/health", async (c) => {
  const d1 = await c.env.DB.prepare("SELECT 1").first().then(() => true, () => false);
  return json({ ok: d1, d1 });
});

registerAuthRoutes(router);
registerCourseRoutes(router);
registerAssessmentRoutes(router);
registerStudyRoutes(router);

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`)) return router.handle(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
