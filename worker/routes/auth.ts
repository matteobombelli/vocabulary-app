import { LoginBody, RegisterBody, type User } from "../../shared/api";
import { newId } from "../../shared/ids";
import { DUMMY_HASH, hashPassword, verifyPassword } from "../auth/password";
import { SESSION_COOKIE, createSession, destroySession, requireUser } from "../auth/session";
import { json, now, parseJson, readCookie } from "../http";
import { HttpError, type Router } from "../router";

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
}

export function registerAuthRoutes(r: Router): void {
  r.post("/auth/register", async (c) => {
    const body = await parseJson(c.req, RegisterBody);
    if (!(await sameSecret(body.inviteCode, c.env.REGISTRATION_SECRET))) throw new HttpError(403, "Invalid invite code");
    const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(body.email).first();
    if (existing) throw new HttpError(409, "Email already registered");
    const user: User = { id: newId(), email: body.email };
    try {
      await c.env.DB.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
        .bind(user.id, user.email, await hashPassword(body.password), now())
        .run();
    } catch (err) {
      // Two concurrent registrations can both pass the SELECT above; the UNIQUE index settles it.
      if (err instanceof Error && err.message.includes("UNIQUE")) throw new HttpError(409, "Email already registered");
      throw err;
    }
    await createSession(c, user.id);
    return json({ user }, 201);
  });

  r.post("/auth/login", async (c) => {
    const body = await parseJson(c.req, LoginBody);
    const row = await c.env.DB.prepare("SELECT id, email, password_hash FROM users WHERE email = ?")
      .bind(body.email)
      .first<UserRow>();
    const ok = await verifyPassword(body.password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !ok) throw new HttpError(401, "Invalid email or password");
    await createSession(c, row.id);
    return json({ user: { id: row.id, email: row.email } satisfies User });
  });

  // An expired or revoked session still gets its cookie cleared; only a request without one is refused.
  r.post("/auth/logout", async (c) => {
    if (!readCookie(c.req, SESSION_COOKIE)) throw new HttpError(401, "Unauthorized");
    await destroySession(c);
    return new Response(null, { status: 204 });
  });

  r.get("/auth/me", async (c) => {
    const user = await requireUser(c);
    return json({ user });
  });
}

// Compares digests so the time taken does not depend on how much of the code was right.
async function sameSecret(given: string, secret: string): Promise<boolean> {
  const digest = (s: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  const [a, b] = await Promise.all([digest(given), digest(secret)]);
  return crypto.subtle.timingSafeEqual(a, b);
}
