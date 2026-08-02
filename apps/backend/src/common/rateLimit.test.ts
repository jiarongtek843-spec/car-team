import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { buildRateLimiter } from "./rateLimit.js";

function buildTestApp(limit: number) {
  const app = express();
  app.use(buildRateLimiter({ windowMs: 60_000, limit, message: { error: "请求太频繁，请稍后再试" } }, { forceEnable: true }));
  app.get("/ping", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("buildRateLimiter", () => {
  it("放行限额以内的请求，超过之后回 429 并带清楚的中文讯息", async () => {
    const app = buildTestApp(3);

    for (let i = 0; i < 3; i++) {
      const res = await request(app).get("/ping");
      expect(res.status).toBe(200);
    }

    const blocked = await request(app).get("/ping");
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: "请求太频繁，请稍后再试" });
  });

  it("forceEnable 没开的话（一般测试环境）不会真的限流，即使远超过设定的 limit", async () => {
    const app = express();
    app.use(buildRateLimiter({ windowMs: 60_000, limit: 1, message: { error: "请求太频繁，请稍后再试" } }));
    app.get("/ping", (_req, res) => res.json({ ok: true }));

    for (let i = 0; i < 5; i++) {
      const res = await request(app).get("/ping");
      expect(res.status).toBe(200);
    }
  });
});
