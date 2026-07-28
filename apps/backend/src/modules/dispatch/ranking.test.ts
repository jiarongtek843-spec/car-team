import { describe, expect, it } from "vitest";
import { haversineDistanceKm, rankDrivers, type RankingCandidateDriver } from "./ranking.js";

describe("haversineDistanceKm", () => {
  it("同一个点距离是 0", () => {
    expect(haversineDistanceKm(3.139, 101.6869, 3.139, 101.6869)).toBe(0);
  });

  it("吉隆坡市中心到吉隆坡国际机场（KLIA）大约 45-55 公里", () => {
    // KLCC ≈ 3.1579,101.7116；KLIA ≈ 2.7456,101.7099——真实世界的距离拿来当回归测试基准，
    // 不是随便编的两个坐标。
    const distance = haversineDistanceKm(3.1579, 101.7116, 2.7456, 101.7099);
    expect(distance).toBeGreaterThan(40);
    expect(distance).toBeLessThan(60);
  });
});

function makeDriver(overrides: Partial<RankingCandidateDriver> & { id: number }): RankingCandidateDriver {
  return { latitude: null, longitude: null, completedToday: 0, ...overrides };
}

describe("Phase 1 Driver Ranking Engine", () => {
  it("核心规则 #4：两台车都有坐标时，距离近的排前面", () => {
    // 上车点是 28（用 3.139,101.6869 当假坐标）。
    const near = makeDriver({ id: 1, latitude: 3.14, longitude: 101.687 });
    const far = makeDriver({ id: 2, latitude: 3.2, longitude: 101.75 });
    const ranked = rankDrivers([far, near], { pickupLatitude: 3.139, pickupLongitude: 101.6869 });
    expect(ranked.map((r) => r.candidate.id)).toEqual([1, 2]);
    expect(ranked[0].distanceKm).not.toBeNull();
  });

  it("没有上车点坐标时，距离全部是 null，退回今日已完成趟数由少到多排序", () => {
    const busy = makeDriver({ id: 1, latitude: 3.14, longitude: 101.687, completedToday: 5 });
    const fresh = makeDriver({ id: 2, latitude: 3.15, longitude: 101.7, completedToday: 1 });
    const ranked = rankDrivers([busy, fresh], { pickupLatitude: null, pickupLongitude: null });
    expect(ranked.every((r) => r.distanceKm === null)).toBe(true);
    expect(ranked.map((r) => r.candidate.id)).toEqual([2, 1]);
  });

  it("有坐标的 Driver 一律排在没有坐标的前面", () => {
    const noLocation = makeDriver({ id: 1, latitude: null, longitude: null, completedToday: 0 });
    const withLocation = makeDriver({ id: 2, latitude: 3.14, longitude: 101.687, completedToday: 9 });
    const ranked = rankDrivers([noLocation, withLocation], { pickupLatitude: 3.139, pickupLongitude: 101.6869 });
    expect(ranked.map((r) => r.candidate.id)).toEqual([2, 1]);
  });

  it("空的合格名单回传空阵列", () => {
    expect(rankDrivers([], { pickupLatitude: null, pickupLongitude: null })).toEqual([]);
  });
});
