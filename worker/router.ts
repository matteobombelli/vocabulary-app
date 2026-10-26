import { z } from "zod";
import { API_PREFIX } from "../shared/api";

export interface Ctx {
  req: Request;
  env: Env;
  url: URL;
  params: Record<string, string>;
  exec: ExecutionContext;
  // Anything appended here (e.g. Set-Cookie) is merged onto the handler's Response by Router.handle.
  responseHeaders: Headers;
}

export type Handler = (c: Ctx) => Promise<Response> | Response;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

interface Route {
  method: string;
  regex: RegExp;
  paramNames: string[];
  handler: Handler;
}

function compilePattern(pattern: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const source = pattern
    .split("/")
    .map((seg) => {
      if (seg.startsWith(":")) {
        paramNames.push(seg.slice(1));
        return "([^/]+)";
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^${source}$`), paramNames };
}

export class Router {
  private routes: Route[] = [];

  private add(method: string, pattern: string, handler: Handler): this {
    this.routes.push({ method, ...compilePattern(pattern), handler });
    return this;
  }

  get(pattern: string, h: Handler): this {
    return this.add("GET", pattern, h);
  }
  post(pattern: string, h: Handler): this {
    return this.add("POST", pattern, h);
  }
  put(pattern: string, h: Handler): this {
    return this.add("PUT", pattern, h);
  }
  patch(pattern: string, h: Handler): this {
    return this.add("PATCH", pattern, h);
  }
  delete(pattern: string, h: Handler): this {
    return this.add("DELETE", pattern, h);
  }

  async handle(req: Request, env: Env, exec: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.slice(API_PREFIX.length);
    const c: Ctx = { req, env, url, params: {}, exec, responseHeaders: new Headers() };
    try {
      const res = await this.dispatch(c, path);
      return mergeHeaders(res, c.responseHeaders);
    } catch (err) {
      return mergeHeaders(errorResponse(err), c.responseHeaders);
    }
  }

  private dispatch(c: Ctx, path: string): Promise<Response> | Response {
    const isHead = c.req.method === "HEAD";
    for (const route of this.routes) {
      if (route.method !== (isHead ? "GET" : c.req.method)) continue;
      const m = route.regex.exec(path);
      if (!m) continue;
      try {
        route.paramNames.forEach((name, i) => {
          c.params[name] = decodeURIComponent(m[i + 1]);
        });
      } catch {
        throw new HttpError(400, "Bad request");
      }
      const res = route.handler(c);
      return isHead ? Promise.resolve(res).then(withoutBody) : res;
    }
    throw new HttpError(404, "Not found");
  }
}

// A HEAD answers exactly as the GET would, headers included, with the body dropped. Cancelling
// releases the upstream (R2) stream now instead of leaving it to be collected.
function withoutBody(res: Response): Response {
  void res.body?.cancel();
  return new Response(null, { status: res.status, statusText: res.statusText, headers: res.headers });
}

function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    const body = err.details === undefined ? { error: err.message } : { error: err.message, details: err.details };
    return Response.json(body, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return Response.json({ error: "Validation failed", details: z.treeifyError(err) }, { status: 400 });
  }
  console.error(err);
  return Response.json({ error: "Internal error" }, { status: 500 });
}

function mergeHeaders(res: Response, extra: Headers): Response {
  if ([...extra].length === 0) return res;
  const headers = new Headers(res.headers);
  for (const [k, v] of extra) {
    if (k.toLowerCase() === "set-cookie") continue;
    headers.append(k, v);
  }
  // Each Set-Cookie must stay a separate header; iterating a Headers object may fold them into one value.
  for (const cookie of extra.getSetCookie()) headers.append("Set-Cookie", cookie);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
