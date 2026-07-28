import { describe, expect, it } from "vitest";
import { findEligibleDrivers, PHASE1_ELIGIBILITY_RULES, type EligibilityCandidateDriver } from "./eligibility.js";

function makeDriver(overrides: Partial<EligibilityCandidateDriver> & { id: number }): EligibilityCandidateDriver {
  return { status: "ACTIVE", presenceStatus: "ONLINE", workloadStatus: "IDLE", ...overrides };
}

describe("Phase 1 Driver Eligibility Engine", () => {
  it("核心规则 #1：INACTIVE 的 Driver 不合格", () => {
    const drivers = [makeDriver({ id: 1, status: "INACTIVE" }), makeDriver({ id: 2 })];
    const eligible = findEligibleDrivers(drivers, { excludeDriverIds: [] });
    expect(eligible.map((d) => d.id)).toEqual([2]);
  });

  it("核心规则 #2：Offline 或 Connection Lost 的 Driver 不合格", () => {
    const drivers = [
      makeDriver({ id: 1, presenceStatus: "OFFLINE" }),
      makeDriver({ id: 2, presenceStatus: "CONNECTION_LOST" }),
      makeDriver({ id: 3, presenceStatus: "ONLINE" })
    ];
    const eligible = findEligibleDrivers(drivers, { excludeDriverIds: [] });
    expect(eligible.map((d) => d.id)).toEqual([3]);
  });

  it("核心规则 #3：手上已经有工作（BUSY）的 Driver 不合格", () => {
    const drivers = [makeDriver({ id: 1, workloadStatus: "BUSY" }), makeDriver({ id: 2, workloadStatus: "IDLE" })];
    const eligible = findEligibleDrivers(drivers, { excludeDriverIds: [] });
    expect(eligible.map((d) => d.id)).toEqual([2]);
  });

  it("已经在这个 Leg 上被拒绝/超时过的 Driver 会被排除", () => {
    const drivers = [makeDriver({ id: 1 }), makeDriver({ id: 2 })];
    const eligible = findEligibleDrivers(drivers, { excludeDriverIds: [1] });
    expect(eligible.map((d) => d.id)).toEqual([2]);
  });

  it("四条规则都满足的 Driver 才会出现在结果里", () => {
    const drivers = [
      makeDriver({ id: 1 }),
      makeDriver({ id: 2, status: "INACTIVE" }),
      makeDriver({ id: 3, presenceStatus: "OFFLINE" }),
      makeDriver({ id: 4, workloadStatus: "BUSY" }),
      makeDriver({ id: 5 })
    ];
    const eligible = findEligibleDrivers(drivers, { excludeDriverIds: [5] }, PHASE1_ELIGIBILITY_RULES);
    expect(eligible.map((d) => d.id)).toEqual([1]);
  });

  it("没有任何合格 Driver 时回传空阵列，不是 null/undefined", () => {
    const drivers = [makeDriver({ id: 1, status: "INACTIVE" })];
    expect(findEligibleDrivers(drivers, { excludeDriverIds: [] })).toEqual([]);
  });
});
