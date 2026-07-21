import { useAuth } from "./AuthContext";
import type { PermissionKey } from "../../common/permissions";

/** 前端权限判断只是 UX 层的显示/隐藏，不是安全边界——真正的检查一律在 Backend 的
 * requirePermission middleware。这里只是让导览列/按钮不要显示使用者点了也会被 403 的东西。 */
export function usePermission(permission: PermissionKey): boolean {
  const { user } = useAuth();
  return user?.permissions.includes(permission) ?? false;
}

export function useHasAnyPermission(permissions: PermissionKey[]): boolean {
  const { user } = useAuth();
  if (!user) return false;
  return permissions.some((p) => user.permissions.includes(p));
}
