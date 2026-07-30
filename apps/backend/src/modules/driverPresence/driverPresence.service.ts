import type { ActivityLog, DriverPresenceState, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { subscribeToActivity } from "../activityLog/activityLog.service.js";

/**
 * Driver Presence（2026-07）：司机现在状态的唯一权威来源，见 schema.prisma 的
 * DriverPresence model 注解。跟 Notification Center 用一模一样的机制——订阅
 * activityLog.service.ts 的 Subscriber，每次有人呼叫 createActivity() 就依照下面的规则
 * 决定要不要更新某个司机的状态。业务模块（Dispatch/DriverJobs/GPS）永远只呼叫
 * createActivity()，不会、也不需要知道 Driver Presence 这个模块存在。
 *
 * 状态转换规则（module/activityType 对应哪个新状态）：
 *   DISPATCH/OFFER_SENT       -> PENDING_OFFER（收到 Offer 的司机）
 *   DISPATCH/OFFER_ACCEPTED   -> 赢家 ACCEPTED_JOB；同一个 Leg 上其他还是 PENDING_OFFER
 *                                 的司机（陪标者）一并reset回 AVAILABLE
 *   DISPATCH/OFFER_DECLINED   -> 如果司机目前正跟踪的 Leg 就是这个，reset 回 AVAILABLE
 *   DISPATCH/OFFER_EXPIRED    -> 同上
 *   DISPATCH/DRIVER_ASSIGNED  -> ACCEPTED_JOB（Dispatcher 手动指派，跳过 Offer 流程）
 *   DISPATCH/LEG_CANCELLED    -> 如果司机目前正跟踪的 Leg 就是这个，reset 回 AVAILABLE
 *   DRIVER_JOBS/LEG_ACCEPTED  -> 维持 ACCEPTED_JOB，只更新 lastSeenAt
 *   DRIVER_JOBS/DRIVER_ARRIVING    -> ON_TRIP
 *   DRIVER_JOBS/PASSENGER_ON_BOARD -> ON_TRIP
 *   DRIVER_JOBS/LEG_COMPLETED -> AVAILABLE，清空 current*
 *   DRIVER_JOBS/LEG_REJECTED  -> AVAILABLE，清空 current*
 *   GPS/DRIVER_ONLINE         -> AVAILABLE（只在目前是 OFFLINE 时才切换，避免盖掉正在跑的工作）
 *   GPS/DRIVER_OFFLINE        -> OFFLINE，清空 current*
 *
 * BREAK 这次没有任何触发点会用到（保留给未来）。
 */

type PrismaClientOrTx = Prisma.TransactionClient | typeof prisma;

async function upsertPresence(
  client: PrismaClientOrTx,
  driverId: number,
  data: {
    status: DriverPresenceState;
    currentBookingId?: number | null;
    currentLegId?: number | null;
  }
) {
  const now = new Date();
  await client.driverPresence.upsert({
    where: { driverId },
    create: {
      driverId,
      status: data.status,
      currentBookingId: data.currentBookingId ?? null,
      currentLegId: data.currentLegId ?? null,
      lastSeenAt: now
    },
    update: {
      status: data.status,
      ...(data.currentBookingId !== undefined ? { currentBookingId: data.currentBookingId } : {}),
      ...(data.currentLegId !== undefined ? { currentLegId: data.currentLegId } : {}),
      lastSeenAt: now
    }
  });
}

/** 只更新 lastSeenAt，不动 status/current*——DRIVER_JOBS/LEG_ACCEPTED 这种「状态没变但司机确实有动作」的事件用。 */
async function touchLastSeen(client: PrismaClientOrTx, driverId: number) {
  await client.driverPresence.upsert({
    where: { driverId },
    create: { driverId, status: "ACCEPTED_JOB", lastSeenAt: new Date() },
    update: { lastSeenAt: new Date() }
  });
}

/** 只有司机目前跟踪的 Leg 就是这个事件的 Leg 时才 reset——避免旧事件（例如逾时才处理到的 Offer Expired）誤把司机已经在跑的新工作盖掉。 */
async function resetIfTrackingLeg(client: PrismaClientOrTx, driverId: number, legId: number) {
  const current = await client.driverPresence.findUnique({ where: { driverId } });
  if (current && current.currentLegId === legId) {
    await upsertPresence(client, driverId, { status: "AVAILABLE", currentBookingId: null, currentLegId: null });
  } else if (!current) {
    // 从来没有 Presence 纪录（理论上不该发生，防御性处理）：视为本来就是 Available。
    await upsertPresence(client, driverId, { status: "AVAILABLE", currentBookingId: null, currentLegId: null });
  }
}

async function resolveBookingIdForLeg(client: PrismaClientOrTx, legId: number): Promise<number | null> {
  const leg = await client.leg.findUnique({ where: { id: legId }, select: { bookingId: true } });
  return leg?.bookingId ?? null;
}

export async function handleActivity(activity: ActivityLog, client: PrismaClientOrTx) {
  const { module, activityType, subjectDriverId, entityType, entityId } = activity;
  const legId = entityType === "Leg" ? entityId : null;

  if (module === "DISPATCH" && activityType === "OFFER_SENT" && subjectDriverId && legId) {
    const bookingId = await resolveBookingIdForLeg(client, legId);
    await upsertPresence(client, subjectDriverId, { status: "PENDING_OFFER", currentBookingId: bookingId, currentLegId: legId });
    return;
  }

  if (module === "DISPATCH" && activityType === "OFFER_ACCEPTED" && subjectDriverId && legId) {
    const bookingId = await resolveBookingIdForLeg(client, legId);
    await upsertPresence(client, subjectDriverId, { status: "ACCEPTED_JOB", currentBookingId: bookingId, currentLegId: legId });

    // 同一个 Leg 上其他还在 PENDING_OFFER 的陪标者，全部 reset 回 AVAILABLE。
    const siblings = await client.driverPresence.findMany({
      where: { currentLegId: legId, status: "PENDING_OFFER", driverId: { not: subjectDriverId } }
    });
    for (const sibling of siblings) {
      await upsertPresence(client, sibling.driverId, { status: "AVAILABLE", currentBookingId: null, currentLegId: null });
    }
    return;
  }

  if (
    module === "DISPATCH" &&
    (activityType === "OFFER_DECLINED" || activityType === "OFFER_EXPIRED") &&
    subjectDriverId &&
    legId
  ) {
    await resetIfTrackingLeg(client, subjectDriverId, legId);
    return;
  }

  if (module === "DISPATCH" && activityType === "DRIVER_ASSIGNED" && subjectDriverId && legId) {
    const bookingId = await resolveBookingIdForLeg(client, legId);
    await upsertPresence(client, subjectDriverId, { status: "ACCEPTED_JOB", currentBookingId: bookingId, currentLegId: legId });
    return;
  }

  if (module === "DISPATCH" && activityType === "LEG_CANCELLED" && subjectDriverId && legId) {
    await resetIfTrackingLeg(client, subjectDriverId, legId);
    return;
  }

  if (module === "DRIVER_JOBS" && activityType === "LEG_ACCEPTED" && subjectDriverId) {
    await touchLastSeen(client, subjectDriverId);
    return;
  }

  if (
    module === "DRIVER_JOBS" &&
    (activityType === "DRIVER_ARRIVING" || activityType === "PASSENGER_ON_BOARD") &&
    subjectDriverId &&
    legId
  ) {
    const bookingId = await resolveBookingIdForLeg(client, legId);
    await upsertPresence(client, subjectDriverId, { status: "ON_TRIP", currentBookingId: bookingId, currentLegId: legId });
    return;
  }

  if (
    module === "DRIVER_JOBS" &&
    (activityType === "LEG_COMPLETED" || activityType === "LEG_REJECTED") &&
    subjectDriverId
  ) {
    await upsertPresence(client, subjectDriverId, { status: "AVAILABLE", currentBookingId: null, currentLegId: null });
    return;
  }

  if (module === "GPS" && activityType === "DRIVER_ONLINE" && subjectDriverId) {
    const current = await client.driverPresence.findUnique({ where: { driverId: subjectDriverId } });
    if (!current || current.status === "OFFLINE") {
      await upsertPresence(client, subjectDriverId, { status: "AVAILABLE" });
    } else {
      await touchLastSeen(client, subjectDriverId);
    }
    return;
  }

  if (module === "GPS" && activityType === "DRIVER_OFFLINE" && subjectDriverId) {
    await upsertPresence(client, subjectDriverId, { status: "OFFLINE", currentBookingId: null, currentLegId: null });
    return;
  }
}

subscribeToActivity(handleActivity);

// ---------------------------------------------------------------------------
// Read API：Dispatch 页面的 Driver Status 区块用。
// ---------------------------------------------------------------------------

const presenceSelect = {
  status: true,
  lastSeenAt: true,
  currentBooking: { select: { id: true, girlName: true } },
  currentLeg: { select: { id: true, sequence: true, legType: true } }
} satisfies Prisma.DriverPresenceSelect;

export async function listPresence() {
  const drivers = await prisma.driver.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      vehiclePlateNumber: true,
      isOnline: true,
      onlineSince: true,
      presence: { select: presenceSelect }
    },
    orderBy: { name: "asc" }
  });

  return drivers.map((driver) => {
    // 防御性 fallback：理论上每个 Driver 在建立当下就该有一笔 DriverPresence（migration 已经
    // backfill 既有资料），但如果真的漏掉了，用既有的 isOnline 栏位合成一个合理的默认值，
    // 不要整页因为一笔缺资料就爆掉。
    const presence = driver.presence ?? {
      status: driver.isOnline ? ("AVAILABLE" as const) : ("OFFLINE" as const),
      lastSeenAt: driver.onlineSince,
      currentBooking: null,
      currentLeg: null
    };

    return {
      driverId: driver.id,
      driverName: driver.name,
      vehiclePlateNumber: driver.vehiclePlateNumber,
      status: presence.status,
      currentBooking: presence.currentBooking,
      currentLeg: presence.currentLeg,
      lastSeenAt: presence.lastSeenAt
    };
  });
}

export async function getPresenceForDriver(driverId: number) {
  const presence = await prisma.driverPresence.findUnique({
    where: { driverId },
    select: presenceSelect
  });
  return presence;
}
