import type { ReactNode } from "react";
import { usePermission } from "./usePermission";
import type { PermissionKey } from "../../common/permissions";

/** 只在使用者有对应 Permission 时才渲染 children，纯 UX 层隐藏，不是安全边界。 */
export function PermissionGate({ permission, children }: { permission: PermissionKey; children: ReactNode }) {
  const allowed = usePermission(permission);
  if (!allowed) return null;
  return <>{children}</>;
}
