/**
 * Phase 1 Driver Eligibility Engine（docs/design/phase2-gps-dispatch-architecture.md §3.1）。
 * 每条 Rule 都只回答「这个 Driver 能不能收到这个 Offer」，不做排序、不算分——排序是
 * Ranking Engine（ranking.ts）的事。Rule 列表本身刻意保持简单：Phase 1 只做业务已经
 * 明确要的三条（+一条内部用的重复排除），VIP/Fleet/City/VehicleType 等规则留在设计文件
 * 标记为 Future Extension，不在这里实作。
 */

export interface EligibilityCandidateDriver {
  id: number;
  /** ACTIVE_STATUS 检查用；目前唯一的呼叫端（dispatch.service.ts）已经用同一条件查过一次
   * DB（listDispatchDrivers 只回传 status === "ACTIVE" 的 Driver），这里维持显式检查只是
   * 让规则本身可以独立测试，不代表会重复查一次 DB。 */
  status: "ACTIVE" | "INACTIVE";
  /** 对应 gps.service.ts 的 computePresenceStatus 回传值（ONLINE/OFFLINE/CONNECTION_LOST/
   * 或某个进行中的 Leg 状态）。 */
  presenceStatus: string;
  workloadStatus: "BUSY" | "IDLE";
}

export interface EligibilityContext {
  /** 已经在这个 Leg 上被拒绝/超时过的 Driver（下一轮 wave 用，见 §3.7）——Phase 1 目前
   * 还没有 wave 机制会真的填这个，先留着让 Rule 已经能测。 */
  excludeDriverIds: number[];
}

export interface EligibilityRule {
  name: string;
  isSatisfiedBy(candidate: EligibilityCandidateDriver, ctx: EligibilityContext): boolean;
}

export const ACTIVE_STATUS: EligibilityRule = {
  name: "ACTIVE_STATUS",
  isSatisfiedBy: (candidate) => candidate.status === "ACTIVE"
};

/** 核心规则 #2："Driver must be Online / Available."
 * presenceStatus 为 CONNECTION_LOST 也算——业务明确要求上下线只能由司机自己手动控制，
 * GPS 暂时没更新（背景权限/网路问题）不该让系统自作主张把这个司机从可派单名单里剔除，
 * 司机本来就还能透过 Web Push 收到通知、手动 Accept。真正被排除的只有司机自己按了
 * Offline（isOnline=false → presenceStatus === "OFFLINE"）或手上已经有工作在忙
 * （workloadStatus !== "IDLE"）。 */
export const ONLINE_AVAILABLE: EligibilityRule = {
  name: "ONLINE_AVAILABLE",
  isSatisfiedBy: (candidate) =>
    (candidate.presenceStatus === "ONLINE" || candidate.presenceStatus === "CONNECTION_LOST") &&
    candidate.workloadStatus === "IDLE"
};

/** 核心规则 #3："Driver must not have an overlapping active job." 跟 ONLINE_AVAILABLE 的
 * workload 那一半是同一个底层判断，刻意拆成独立命名的 Rule——因为这是业务明确点名要的
 * 规则，需要能单独测试、单独说明，不只是藏在另一条规则里面的副作用。 */
export const NO_OVERLAPPING_ACTIVE_JOB: EligibilityRule = {
  name: "NO_OVERLAPPING_ACTIVE_JOB",
  isSatisfiedBy: (candidate) => candidate.workloadStatus === "IDLE"
};

export const NOT_ALREADY_ATTEMPTED: EligibilityRule = {
  name: "NOT_ALREADY_ATTEMPTED",
  isSatisfiedBy: (candidate, ctx) => !ctx.excludeDriverIds.includes(candidate.id)
};

export const PHASE1_ELIGIBILITY_RULES: EligibilityRule[] = [
  ACTIVE_STATUS,
  ONLINE_AVAILABLE,
  NO_OVERLAPPING_ACTIVE_JOB,
  NOT_ALREADY_ATTEMPTED
];

export function findEligibleDrivers<T extends EligibilityCandidateDriver>(
  candidates: T[],
  ctx: EligibilityContext,
  rules: EligibilityRule[] = PHASE1_ELIGIBILITY_RULES
): T[] {
  return candidates.filter((candidate) => rules.every((rule) => rule.isSatisfiedBy(candidate, ctx)));
}
