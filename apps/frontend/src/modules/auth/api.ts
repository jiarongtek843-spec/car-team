import { http } from "../../api/http";
import type { AuthUser } from "../../types/auth";

export function fetchMe() {
  return http.get<AuthUser>("/api/auth/me");
}

export function login(username: string, password: string) {
  return http.post<AuthUser>("/api/auth/login", { username, password });
}

export function logout() {
  return http.post<void>("/api/auth/logout");
}
