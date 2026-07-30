import type { NextFunction, Request, Response } from "express";
import type { PermissionKey } from "../../common/permissions.js";
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

/**
 * Stabilization：requireAuth/requirePermission 在大多数 router 文件里是直接当 middleware
 * 挂载（不是透过 asyncHandler），改成 throw AppError 让它们统一走 errorHandler.ts 的话，
 * 需要把每个挂载点都包一层 asyncHandler 才不会变成没接住的 unhandled rejection——范围太大、
 * 风险跟这次 Stabilization 想要的「低风险」不成比例。这里改成低风险的做法：维持原本直接
 * res.json() 的行为，只是在回应之前补一行 console.warn，让失败的登入验证/权限检查至少
 * 在 Logs 里留下痕迹（之前完全没有，稽核时看不到任何被拒绝的存取尝试）。
 */
function logAuthFailure(req: Request, statusCode: 401 | 403, message: string) {
  console.warn(`[AUTH_ERROR] ${statusCode} ${req.method} ${req.originalUrl} — ${message}`);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = req.session.userId;
  if (!userId) {
    logAuthFailure(req, 401, "No active session");
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const user = await getActiveUserById(userId);
  if (!user) {
    req.session.destroy(() => {});
    logAuthFailure(req, 401, "Session user is inactive or no longer exists");
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  req.authUser = sanitizeUser(user);
  next();
}

export function requirePermission(permission: PermissionKey) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      logAuthFailure(req, 401, "No active session");
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (!req.authUser.permissions.includes(permission)) {
      logAuthFailure(req, 403, `User ${req.authUser.id} lacks permission "${permission}"`);
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}
