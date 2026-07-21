import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Spin } from "antd";
import { useAuth } from "./AuthContext";
import { homePathForUser, isDriverRole } from "./roleHelpers";
import type { PermissionKey } from "../../common/permissions";

interface RequireAuthProps {
  /** 粗粒度切换：这个路由树是 Admin Portal 还是 Driver Portal（决定套哪个 Layout）。 */
  portal: "admin" | "driver";
  /** 细粒度权限检查，给单一页面用（例如 /wallet 需要 wallet:read）。不传就只做 portal 检查。 */
  permission?: PermissionKey;
  children: ReactNode;
}

export function RequireAuth({ portal, permission, children }: RequireAuthProps) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const userPortal = isDriverRole(user) ? "driver" : "admin";
  if (userPortal !== portal) {
    return <Navigate to={homePathForUser(user)} replace />;
  }

  if (permission && !user.permissions.includes(permission)) {
    return <Navigate to={homePathForUser(user)} replace />;
  }

  return <>{children}</>;
}
