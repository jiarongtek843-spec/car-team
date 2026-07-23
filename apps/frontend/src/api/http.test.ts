import { afterEach, describe, expect, it, vi } from "vitest";
import { http, setUnauthorizedHandler } from "./http";

// Critical Bug（Railway Staging Safari "Not authenticated"）回归测试：
// 1. 每一支请求都必须带 credentials:"include"，不然 Session Cookie 根本不会被浏览器送出。
// 2. 收到 401 时必须通知外部（AuthContext 会拿这个通知去清 user state + 导回 Login），
//    不能默默吞掉、让页面停在「看起来还登入」的状态。
describe("http client — credentials 与 401 handler", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
  });

  it("get/post/patch/delete 每一支都带 credentials:include", async () => {
    // 每次呼叫都要回传一个新的 Response 实例——Response.body 是 stream，读过一次
    // 就不能再读，用同一个实例给 4 支请求共用会在第 2 支就炸掉。
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    await http.get("/api/bookings");
    await http.post("/api/bookings", { girlName: "x" });
    await http.patch("/api/bookings/1", { girlName: "y" });
    await http.delete("/api/bookings/1");

    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const call of fetchMock.mock.calls) {
      const options = call[1] as RequestInit;
      expect(options.credentials).toBe("include");
    }
  });

  it("postForm（文件上传）也带 credentials:include", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    await http.postForm("/api/driver/collections", new FormData());

    expect(fetchMock).toHaveBeenCalledOnce();
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(options.credentials).toBe("include");
  });

  it("收到 401 时会呼叫已注册的 unauthorized handler", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const handler = vi.fn();
    setUnauthorizedHandler(handler);

    await expect(http.get("/api/drivers")).rejects.toThrow();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("没有 401 时不会呼叫 unauthorized handler（避免正常的 404/409 也被误判成过期）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Conflict" }), { status: 409 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const handler = vi.fn();
    setUnauthorizedHandler(handler);

    await expect(http.get("/api/drivers")).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });
});
