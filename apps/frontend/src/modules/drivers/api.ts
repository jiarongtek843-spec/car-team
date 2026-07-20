import { http } from "../../api/http";
import type { Driver, DriverStatus } from "../../types/booking";

export function fetchDrivers(status?: DriverStatus) {
  const query = status ? `?status=${status}` : "";
  return http.get<Driver[]>(`/api/drivers${query}`);
}

export function createDriver(input: { name: string; phone?: string }) {
  return http.post<Driver>("/api/drivers", input);
}
