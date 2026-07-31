import type { Request, Response } from "express";
import { z } from "zod";
import * as authService from "./auth.service.js";
import { actorFromRequest, writeAuditLog } from "../../common/audit.js";
import type { RoleKey } from "../../common/permissions.js";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

const updateMeSchema = z
  .object({
    currentPassword: z.string().min(1),
    newUsername: z.string().min(3).max(50).optional(),
    newPassword: z.string().min(6).optional()
  })
  .refine((v) => v.newUsername !== undefined || v.newPassword !== undefined, {
    message: "At least one of newUsername or newPassword must be provided"
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
    actor: { id: user.id, role: user.role.key as RoleKey },
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
      actor: { id: userId },
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

export async function updateMe(req: Request, res: Response) {
  const input = updateMeSchema.parse(req.body);
  const userId = req.authUser!.id;

  const { updated, usernameChanged, passwordChanged } = await authService.updateOwnCredentials(userId, input);

  // 只记「有没有改」，绝对不能把密码明文/雜湊写进 Audit Log。
  await writeAuditLog({
    actor: actorFromRequest(req),
    action: "USER_UPDATED_OWN_CREDENTIALS",
    entityType: "User",
    entityId: userId,
    metadata: { usernameChanged, passwordChanged }
  });

  res.json(authService.sanitizeUser(updated));
}
