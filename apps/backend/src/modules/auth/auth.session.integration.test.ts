import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../app.js";
import { prisma } from "../../config/prisma.js";

// Critical Bug（Railway Staging Safari "Not authenticated"）的回归测试。用 supertest 直接打
// 真实的 Express app + 真实的 Session Cookie 往返，而不是只测 service 层——这个 Bug 的本质
// 就是「Cookie 有没有正确地在多次请求之间被浏览器带上」，只有真正发 HTTP 请求、检查
// Set-Cookie/Cookie header 才测得出来，service 层直接呼叫看不出这类问题。
//
// 密码沿用 prisma/seed.ts 的规则：本地开发用固定的 DevPass123!，Staging 用 SEED_PASSWORD
// 环境变量覆写——两边都读同一个环境变量，这份测试才能在本地跟 CI 都对得上已经 seed 好的帐号。
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "DevPass123!";

describe("Session Cookie 认证 — Critical Bug 回归测试", () => {
  it("登入后带同一个 Session Cookie 建立 Driver 成功（不是 Not authenticated）", async () => {
    const agent = request.agent(app);

    const loginRes = await agent.post("/api/auth/login").send({ username: "admin", password: SEED_PASSWORD });
    expect(loginRes.status).toBe(200);

    const createRes = await agent.post("/api/drivers").send({
      name: "Session Test Driver 1",
      phone: "0100000001",
      vehiclePlateNumber: "SESS001"
    });

    expect(createRes.status).toBe(201);
    expect(createRes.body.name).toBe("Session Test Driver 1");

    await prisma.driver.delete({ where: { id: createRes.body.id } });
  });

  it("登入后带同一个 Session Cookie 建立 Booking 成功（不是 Not authenticated）", async () => {
    const agent = request.agent(app);

    const loginRes = await agent.post("/api/auth/login").send({ username: "admin", password: SEED_PASSWORD });
    expect(loginRes.status).toBe(200);

    const createRes = await agent.post("/api/bookings").send({ girlName: "Session Test Booking" });

    expect(createRes.status).toBe(201);
    expect(createRes.body.girlName).toBe("Session Test Booking");

    await prisma.booking.delete({ where: { id: createRes.body.id } });
  });

  it("完全没有带 Cookie 打受保护 API：401 Not authenticated（不是 403）", async () => {
    // 不用 agent（不会保存/送出任何 Cookie），模拟 Safari 把 Session Cookie 当第三方
    // Cookie 挡掉之后，浏览器实际发出的请求长什么样。
    const res = await request(app).post("/api/drivers").send({ name: "Should Not Be Created" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Not authenticated");
  });

  it("已登入但没有权限：403 Forbidden（不能被误报成 401 Not authenticated）", async () => {
    const agent = request.agent(app);

    // dispatcher01 有 driver:read，没有 driver:write（见 common/permissions.ts 的权限矩阵）。
    const loginRes = await agent.post("/api/auth/login").send({ username: "dispatcher01", password: SEED_PASSWORD });
    expect(loginRes.status).toBe(200);

    const res = await agent.post("/api/drivers").send({ name: "Should Not Be Created" });

    expect(res.status).toBe(403);
    expect(res.body.error).not.toBe("Not authenticated");
  });

  it("登入回应的 Set-Cookie 是 httpOnly 且用固定的 car_team_sid 名称", async () => {
    const res = await request(app).post("/api/auth/login").send({ username: "admin", password: SEED_PASSWORD });

    expect(res.status).toBe(200);
    const setCookie = res.headers["set-cookie"];
    expect(setCookie).toBeDefined();
    const sessionCookie = (setCookie as unknown as string[]).find((c) => c.startsWith("car_team_sid="));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie!.toLowerCase()).toContain("httponly");
  });
});
