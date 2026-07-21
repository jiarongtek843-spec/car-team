import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { homePathForUser } from "./roleHelpers";
import type { PermissionKey } from "../../common/permissions";

/** 页面级细粒度权限检查，用在已经被外层 RequireAuth（portal 检查）包住的路由底下，
 * 不重复做 isLoading/未登入判断——只处理「登入了，但没有这个 permission」的情况。 */
export function RequirePermission({ permission, children }: { permission: PermissionKey; children: ReactNode }) {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!user.permissions.includes(permission)) {
    return <Navigate to={homePathForUser(user)} replace />;
  }

  return <>{children}</>;
}
