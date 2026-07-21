import type { AuthUser } from "../../types/auth";

/** Driver Portal 用粗粒度的「是不是 Driver 角色」判断套用哪个 Layout；
 * 不是权限检查，页面内的功能显示/隐藏一律用 usePermission。 */
export function isDriverRole(user: Pick<AuthUser, "role">): boolean {
  return user.role.key === "DRIVER";
}

export function homePathForUser(user: Pick<AuthUser, "role">): string {
  return isDriverRole(user) ? "/driver/jobs" : "/";
}
