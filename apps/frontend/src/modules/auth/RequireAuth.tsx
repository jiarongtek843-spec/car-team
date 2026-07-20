import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Spin } from "antd";
import { useAuth } from "./AuthContext";
import type { UserRole } from "../../types/auth";

export function RequireAuth({ role, children }: { role: UserRole; children: ReactNode }) {
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

  if (user.role !== role) {
    return <Navigate to={user.role === "ADMIN" ? "/" : "/driver/jobs"} replace />;
  }

  return <>{children}</>;
}
