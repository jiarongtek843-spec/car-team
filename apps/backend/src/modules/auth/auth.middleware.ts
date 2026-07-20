import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@prisma/client";
import { getActiveUserById, sanitizeUser } from "./auth.service.js";

export type AuthUser = ReturnType<typeof sanitizeUser>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const user = await getActiveUserById(userId);
  if (!user) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  req.authUser = sanitizeUser(user);
  next();
}

export function requireRole(role: UserRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (req.authUser.role !== role) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}
