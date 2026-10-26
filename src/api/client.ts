import { API_PREFIX } from "../../shared/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

export interface ApiInit {
  method?: string;
  body?: unknown;
  raw?: BodyInit;
  headers?: Record<string, string>;
}

// Fired on any 401 so AuthProvider can drop the cached user.
export const UNAUTHORIZED_EVENT = "vocab:unauthorized";

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...init.headers };
  let body: BodyInit | undefined = init.raw;
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const res = await fetch(`${API_PREFIX}${path}`, {
    method: init.method ?? (body === undefined ? "GET" : "POST"),
    headers,
    body,
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    const err = (payload ?? {}) as { error?: string; details?: unknown };
    throw new ApiError(res.status, err.error ?? res.statusText, err.details);
  }
  return payload as T;
}
