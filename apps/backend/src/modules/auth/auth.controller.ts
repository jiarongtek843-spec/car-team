import type { Request, Response } from "express";
import { z } from "zod";
import * as authService from "./auth.service.js";
import { writeAuditLog } from "../../common/audit.js";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

function destroySession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => (err ? reject(err) : resolve()));
  });
}

export async function login(req: Request, res: Response) {
  const { username, password } = loginSchema.parse(req.body);
  const user = await authService.login(username, password);

  await regenerateSession(req);
  req.session.userId = user.id;
  await saveSession(req);

  await writeAuditLog({
    actorUserId: user.id,
    action: "LOGIN",
    entityType: "User",
    entityId: user.id
  });

  res.json(authService.sanitizeUser(user));
}

export async function logout(req: Request, res: Response) {
  const userId = req.session.userId;
  await destroySession(req);
  res.clearCookie("car_team_sid");

  if (userId) {
    await writeAuditLog({
      actorUserId: userId,
      action: "LOGOUT",
      entityType: "User",
      entityId: userId
    });
  }

  res.status(204).end();
}

export async function me(req: Request, res: Response) {
  res.json(req.authUser);
}
