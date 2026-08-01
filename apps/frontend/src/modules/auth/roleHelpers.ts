import type { AuthUser } from "../../types/auth";
import { PERMISSIONS } from "../../common/permissions";

/** Driver Portal 用粗粒度的「是不是 Driver 角色」判断套用哪个 Layout；
 * 不是权限检查，页面内的功能显示/隐藏一律用 usePermission。 */
export function isDriverRole(user: Pick<AuthUser, "role">): boolean {
  return user.role.key === "DRIVER";
}

/**
 * FINANCE 角色（只看财务总数）没有 booking:read，"/" 是 Booking List Page，会被
 * RequirePermission 挡下再导回 homePathForUser(user) ——如果这里还是回传 "/" 会变成
 * 无限重导。所以没有 booking:read 的使用者一律导去 "/overview"（Collection Read 是
 * 目前唯一「财务总览」角色都有、Dispatcher 没有的 Permission，用来判断该走哪条）。
 */
export function homePathForUser(user: Pick<AuthUser, "role" | "permissions">): string {
  if (isDriverRole(user)) {
    return "/driver/jobs";
  }
  if (user.permissions.includes(PERMISSIONS.BOOKING_READ)) {
    return "/";
  }
  if (user.permissions.includes(PERMISSIONS.COLLECTION_READ)) {
    return "/overview";
  }
  return "/";
}
