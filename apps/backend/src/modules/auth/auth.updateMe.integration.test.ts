import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../app.js";
import { prisma } from "../../config/prisma.js";
import { hashPassword } from "../../common/password.js";
import { ROLE_KEYS } from "../../common/permissions.js";

async function createTestUser(username: string, password: string) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: ROLE_KEYS.OWNER } });
  return prisma.user.create({
    data: { username, passwordHash: await hashPassword(password), roleId: role.id }
  });
}

describe("PATCH /api/auth/me — 帐号自己改用户名/密码", () => {
  let userIds: number[] = [];

  afterEach(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    userIds = [];
  });

  it("目前密码错误：拒绝，且不做任何改动", async () => {
    const user = await createTestUser("selfupdate_wrongpw", "OldPass123!");
    userIds.push(user.id);
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ username: "selfupdate_wrongpw", password: "OldPass123!" });

    const res = await agent.patch("/api/auth/me").send({ currentPassword: "WrongPass!", newPassword: "NewPass123!" });
    expect(res.status).toBe(401);

    const reloaded = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(reloaded.passwordHash).toBe(user.passwordHash);
  });

  it("正确密码 + 新密码：改完旧密码登不进去，新密码登得进去", async () => {
    const user = await createTestUser("selfupdate_pw", "OldPass123!");
    userIds.push(user.id);
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ username: "selfupdate_pw", password: "OldPass123!" });

    const res = await agent.patch("/api/auth/me").send({ currentPassword: "OldPass123!", newPassword: "NewPass456!" });
    expect(res.status).toBe(200);
    expect(res.body.username).toBe("selfupdate_pw");

    const oldLogin = await request(app).post("/api/auth/login").send({ username: "selfupdate_pw", password: "OldPass123!" });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app).post("/api/auth/login").send({ username: "selfupdate_pw", password: "NewPass456!" });
    expect(newLogin.status).toBe(200);
  });

  it("正确密码 + 新用户名：改完旧用户名登不进去，新用户名登得进去", async () => {
    const user = await createTestUser("selfupdate_old_name", "Pass123!");
    userIds.push(user.id);
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ username: "selfupdate_old_name", password: "Pass123!" });

    const res = await agent.patch("/api/auth/me").send({ currentPassword: "Pass123!", newUsername: "selfupdate_new_name" });
    expect(res.status).toBe(200);
    expect(res.body.username).toBe("selfupdate_new_name");

    const oldLogin = await request(app)
      .post("/api/auth/login")
      .send({ username: "selfupdate_old_name", password: "Pass123!" });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post("/api/auth/login")
      .send({ username: "selfupdate_new_name", password: "Pass123!" });
    expect(newLogin.status).toBe(200);
  });

  it("新用户名已经被别人用了：409 拒绝，原本的用户名不变", async () => {
    const userA = await createTestUser("selfupdate_taken_a", "Pass123!");
    const userB = await createTestUser("selfupdate_taken_b", "Pass123!");
    userIds.push(userA.id, userB.id);

    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ username: "selfupdate_taken_a", password: "Pass123!" });

    const res = await agent.patch("/api/auth/me").send({ currentPassword: "Pass123!", newUsername: "selfupdate_taken_b" });
    expect(res.status).toBe(409);

    const reloaded = await prisma.user.findUniqueOrThrow({ where: { id: userA.id } });
    expect(reloaded.username).toBe("selfupdate_taken_a");
  });

  it("newUsername 跟 newPassword 都没填：400", async () => {
    const user = await createTestUser("selfupdate_empty", "Pass123!");
    userIds.push(user.id);
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ username: "selfupdate_empty", password: "Pass123!" });

    const res = await agent.patch("/api/auth/me").send({ currentPassword: "Pass123!" });
    expect(res.status).toBe(400);
  });

  it("没登入直接打：401", async () => {
    const res = await request(app).patch("/api/auth/me").send({ currentPassword: "x", newPassword: "NewPass123!" });
    expect(res.status).toBe(401);
  });
});
