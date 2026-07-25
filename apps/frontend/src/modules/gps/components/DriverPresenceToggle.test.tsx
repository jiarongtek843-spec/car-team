import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../test/renderWithProviders";
import { DriverPresenceToggle } from "./DriverPresenceToggle";
import { http } from "../../../api/http";
import type { DriverPresence } from "../types";

vi.mock("../../../api/http", async () => {
  const actual = await vi.importActual<typeof import("../../../api/http")>("../../../api/http");
  return { ...actual, http: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), postForm: vi.fn() } };
});

const offlinePresence: DriverPresence = {
  driver: { id: 1, name: "Test Driver", vehiclePlateNumber: null },
  status: "OFFLINE",
  secondsSinceUpdate: null,
  location: null,
  activeLeg: null
};

const onlinePresence: DriverPresence = {
  driver: { id: 1, name: "Test Driver", vehiclePlateNumber: null },
  status: "ONLINE",
  secondsSinceUpdate: 0,
  location: null,
  activeLeg: null
};

describe("DriverPresenceToggle（Mobile UAT Bug Fix：真实装置上点上线后 UI 没跟着变）", () => {
  beforeEach(() => {
    vi.mocked(http.post).mockReset();
    vi.mocked(http.get).mockReset();
    Object.defineProperty(global.navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback) => {
          success({ coords: { latitude: 3.1, longitude: 101.6 } } as GeolocationPosition);
        }
      }
    });
  });

  it("背景轮询里一个『点击上线当下就已经飞在空中』的旧 GET 请求，在 mutation 成功之后才回来，不能把最新的 Online 状态盖掉", async () => {
    // 第一次 GET（元件挂载时）立刻回传 Offline，让画面先渲染成 Offline，符合真实情境。
    // 第二次 GET 代表「使用者点击上线的当下，背景轮询已经发出去、还没回来」的那个旧请求——
    // 刻意卡住不 resolve，直到我们在断言之后才手动放行，模拟它比 mutation 晚回来。
    let resolveStalePoll!: (value: DriverPresence) => void;
    const stalePoll = new Promise<DriverPresence>((resolve) => {
      resolveStalePoll = resolve;
    });
    let getCallCount = 0;
    vi.mocked(http.get).mockImplementation(() => {
      getCallCount += 1;
      return getCallCount === 1 ? Promise.resolve(offlinePresence as never) : (stalePoll as never);
    });
    vi.mocked(http.post).mockResolvedValue(onlinePresence as never);

    const { queryClient } = renderWithProviders(<DriverPresenceToggle />);

    await waitFor(() => expect(screen.getByText("Offline")).toBeInTheDocument());

    // 模拟「使用者点击上线的当下，背景轮询已经在飞」：手动触发一次 refetch（不 await，
    // 让它卡在 stalePoll 那个 pending promise 上），代表这个旧请求已经送出去了。
    queryClient.refetchQueries({ queryKey: ["gps", "my-presence"] });
    await waitFor(() => expect(getCallCount).toBe(2));

    await userEvent.click(screen.getByRole("switch"));

    // Mutation（POST /online）应该成功送出，画面应该变成 Online——这一步就算旧的
    // useGoOnlineMutation（没有 cancelQueries）也会先短暂显示正确，所以还不足以证明修复有效。
    await waitFor(() => expect(screen.getByText("Online")).toBeInTheDocument());

    // 关键断言：现在让那个旧的、卡住的背景轮询请求「终于回来」，带着过时的 Offline 资料。
    // 有 cancelQueries 保护的话，这个迟到的回应会被 react-query 直接忽略；没有的话，
    // 画面会被打回 Offline——这正是真实装置上「点了上线、Toast 成功，但画面还是 Offline」
    // 这个 Bug 的真正根因。
    resolveStalePoll(offlinePresence);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(screen.queryByText("Offline")).not.toBeInTheDocument();
  });
});
