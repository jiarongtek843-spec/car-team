import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { message } from "antd";
import * as authApi from "./api";
import { setUnauthorizedHandler } from "../../api/http";
import type { AuthUser } from "../../types/auth";

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // 401 handler 用 ref 读最新 user，避免闭包拿到过期值，又不用把 handler 重新注册一次。
  const userRef = useRef<AuthUser | null>(null);
  userRef.current = user;

  useEffect(() => {
    authApi
      .fetchMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    // 只在「之前确实登入过」时才提示+清 state：应用刚载入、根本还没登入时打 /auth/me
    // 本来就会拿到 401，那是正常情况，不该弹「登录已过期」。真正过期是指使用者
    // 已经在使用中，某次写入/查询才突然收到 401 —— 这时 userRef.current 一定不是 null。
    setUnauthorizedHandler(() => {
      if (userRef.current) {
        setUser(null);
        message.warning("登录已过期，请重新登录");
      }
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  async function login(username: string, password: string) {
    const loggedInUser = await authApi.login(username, password);
    setUser(loggedInUser);
    return loggedInUser;
  }

  async function logout() {
    await authApi.logout();
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, isLoading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
