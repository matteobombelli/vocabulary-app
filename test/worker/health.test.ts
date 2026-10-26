import { describe, expect, it } from "vitest";
import { request } from "./helpers";

describe("GET /health", () => {
  it("reports D1", async () => {
    const res = await request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, d1: true });
  });
});
