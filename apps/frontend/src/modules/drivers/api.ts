import { http } from "../../api/http";
import type { Driver, DriverStatus } from "../../types/booking";

export interface CreateDriverInput {
  name: string;
  phone?: string;
  vehiclePlateNumber?: string;
  remark?: string;
  username?: string;
  password?: string;
}

export interface UpdateDriverInput {
  name?: string;
  phone?: string;
  vehiclePlateNumber?: string;
  remark?: string;
}

export function fetchDrivers(status?: DriverStatus) {
  const query = status ? `?status=${status}` : "";
  return http.get<Driver[]>(`/api/drivers${query}`);
}

export function createDriver(input: CreateDriverInput) {
  return http.post<Driver>("/api/drivers", input);
}

export function updateDriver(id: number, input: UpdateDriverInput) {
  return http.patch<Driver>(`/api/drivers/${id}`, input);
}

export function setDriverStatus(id: number, status: DriverStatus) {
  return http.post<Driver>(`/api/drivers/${id}/status`, { status });
}

export function resetDriverPassword(id: number, password: string) {
  return http.post<void>(`/api/drivers/${id}/reset-password`, { password });
}
