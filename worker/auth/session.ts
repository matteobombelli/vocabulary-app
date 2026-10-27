import type { User } from "../../shared/api";
import { now, readCookie } from "../http";
import { HttpError, type Ctx } from "../router";

export const SESSION_COOKIE = "vocab_session";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_BELOW_MS = 15 * 24 * 60 * 60 * 1000;

interface SessionRow {
  expires_at: number;
  user_id: string;
  email: string;
}

/** sessions.id for a raw cookie token: hex sha256. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function appendSessionCookie(c: Ctx, token: string, maxAgeSeconds: number): void {
  let cookie = `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
  if (c.url.protocol === "https:") cookie += "; Secure";
  c.responseHeaders.append("Set-Cookie", cookie);
}

export async function createSession(c: Ctx, userId: string): Promise<void> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const t = now();
  await c.env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(t).run();
  await c.env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await hashToken(token), userId, t, t + SESSION_TTL_MS)
    .run();
  appendSessionCookie(c, token, SESSION_TTL_MS / 1000);
}

export async function requireUser(c: Ctx): Promise<User> {
  const token = readCookie(c.req, SESSION_COOKIE);
  if (!token) throw new HttpError(401, "Unauthorized");
  const id = await hashToken(token);
  const row = await c.env.DB.prepare(
    "SELECT s.expires_at, s.user_id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?",
  )
    .bind(id)
    .first<SessionRow>();
  if (!row) throw new HttpError(401, "Unauthorized");
  const t = now();
  if (row.expires_at <= t) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run().catch(() => undefined);
    throw new HttpError(401, "Unauthorized");
  }
  if (row.expires_at - t < REFRESH_BELOW_MS) {
    await c.env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").bind(t + SESSION_TTL_MS, id).run();
    appendSessionCookie(c, token, SESSION_TTL_MS / 1000);
  }
  return { id: row.user_id, email: row.email };
}

export async function destroySession(c: Ctx): Promise<void> {
  const token = readCookie(c.req, SESSION_COOKIE);
  if (token) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await hashToken(token)).run();
  }
  // A rolling refresh may already have queued a fresh cookie; the clearing one must be the only one sent.
  c.responseHeaders.delete("Set-Cookie");
  appendSessionCookie(c, "", 0);
}
