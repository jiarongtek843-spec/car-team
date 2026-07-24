// Critical Bug fix (Safari "Not authenticated"): defaults to "" (same-origin,
// relative paths) rather than an absolute cross-origin URL. Frontend and
// Backend on two different *.up.railway.app subdomains are, from a browser's
// point of view, two different *sites* (up.railway.app is on the public
// suffix list) — a session cookie set by the Backend is a third-party cookie
// on the Frontend's page, which Safari's Intelligent Tracking Prevention
// blocks outright regardless of SameSite/Secure. In production this app
// relies on apps/frontend/server.js reverse-proxying /api/* to the Backend,
// so the browser only ever talks to one origin and every cookie is
// first-party. Local dev keeps working exactly as before because
// apps/frontend/.env explicitly sets VITE_API_BASE_URL=http://localhost:4000
// (Vite's dev server has no such proxy, and doesn't need one — localhost on
// two different ports is still the same *site* for SameSite purposes).
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// 401 = 没有登入或 Session 已失效（跟 403 权限不足是两回事，见 auth.middleware.ts）。
// AuthContext 会注册这支 handler：只要收到 401 就清掉 user state，让 RequireAuth
// 自动导回 /login，不会出现「页面看起来还在登入但写入全部失败」的状态。
type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  unauthorizedHandler = handler;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    // Mobile UAT Bug Fix（Driver Online 状态同步）：iOS Safari 对 fetch() 的 GET 请求会用
    // 自己的 HTTP cache（就算 Server 完全没送 Cache-Control，WebKit 在某些情况下还是会
    // heuristically 快取），实测出现过「POST /online 成功、Toast 显示已上线，但接下来
    // react-query invalidateQueries 触发的 GET /driver/presence/me 被 Safari 用快取里
    // 那份『上线前』的旧回应打发，Header/首页 Switch 两边都读到同一份被快取的旧资料，
    // 看起来像状态没同步」。这个 App 里所有 GET 都是每个 Session 专属的动态资料，没有任何
    // 一支 API 是可以被浏览器快取的，所以直接在共用的 fetch 入口统一关闭，不用一支一支 API
    // 各自处理。
    cache: "no-store",
    ...options
  });

  if (res.status === 401) {
    unauthorizedHandler?.();
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? `API error ${res.status}`);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

async function requestForm<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    credentials: "include",
    body: formData
  });

  if (res.status === 401) {
    unauthorizedHandler?.();
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? `API error ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const http = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  // 上传文件用，不能设 Content-Type: application/json——浏览器要自己带 multipart boundary。
  postForm: <T>(path: string, formData: FormData) => requestForm<T>(path, formData)
};
