import { http } from "../../api/http";
import type { DriverPresenceEntry } from "./types";

export function fetchDriverPresence() {
  return http.get<DriverPresenceEntry[]>("/api/admin/driver-presence");
}
