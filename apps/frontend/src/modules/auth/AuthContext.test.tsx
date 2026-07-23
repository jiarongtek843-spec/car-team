import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { message } from "antd";
import { createTestQueryClient } from "../../test/renderWithProviders";
import { AuthProvider } from "./AuthContext";
import { RequireAuth } from "./RequireAuth";
import * as authApi from "./api";
import { http } from "../../api/http";
import type { AuthUser } from "../../types/auth";

vi.mock("./api");

const testUser: AuthUser = {
  id: 1,
  username: "admin",
  role: { key: "OWNER", name: "Owner" },
  permissions: [],
  driver: null
};

function renderApp() {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<div>Login Page</div>} />
            <Route
              path="/"
              element={
                <RequireAuth portal="admin">
                  <div>Protected Content</div>
                </RequireAuth>
              }
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// Critical Bug 要求的 Session UX：Session 真的失效时，不能让使用者停在「看起来还登入」
// 的页面——必须自动清掉 user state、跳回 Login、显示提示，而不是只丢一个 toast 就没了。
describe("Session 过期 UX", () => {
  it("受保护页面运作中收到 401：清 user state + 跳回 /login + 显示「登录已过期，请重新登录」", async () => {
    vi.mocked(authApi.fetchMe).mockResolvedValue(testUser);
    const warnSpy = vi.spyOn(message, "warning").mockImplementation(() => "" as unknown as ReturnType<typeof message.warning>);

    renderApp();

    expect(await screen.findByText("Protected Content")).toBeInTheDocument();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 }))
    );

    await expect(http.get("/api/bookings")).rejects.toThrow();

    await waitFor(() => expect(screen.getByText("Login Page")).toBeInTheDocument());
    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalledWith("登录已过期，请重新登录");

    warnSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("应用刚载入、本来就没登入时打 /auth/me 拿到 401：直接跳 Login，不会误报「已过期」", async () => {
    vi.mocked(authApi.fetchMe).mockRejectedValue(new Error("401"));
    const warnSpy = vi.spyOn(message, "warning").mockImplementation(() => "" as unknown as ReturnType<typeof message.warning>);

    renderApp();

    await waitFor(() => expect(screen.getByText("Login Page")).toBeInTheDocument());
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
