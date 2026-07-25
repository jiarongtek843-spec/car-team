import type { LegStatus } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ConflictError, NotFoundError, ValidationError } from "../../common/errors.js";
import { writeAuditLog, type AuditActor } from "../../common/audit.js";
import { ACTIVE_LEG_STATUSES } from "../bookings/bookings.status.js";
import { getCompanySettings } from "../companySettings/companySettings.service.js";
import { pushDebugLog } from "../../common/debugLog.js";

/**
 * 保底默认值，只在 `computePresenceStatus` 没有明确传阈值时使用（例如既有的单元测试）。
 * Module 8 起，实际跑的阈值来自 CompanySettings（connectionLostTimeoutSeconds/
 * offlineTimeoutSeconds），listDriverPresence/getDriverPresence/dispatch 的调用处
 * 都会明确传值，不会依赖这里的默认值——这两个常数只是「读不到设定时」的保险丝。
 */
export const CONNECTION_LOST_THRESHOLD_SECONDS = 30;
export const AUTO_OFFLINE_THRESHOLD_SECONDS = 120;

/**
 * Driver 目前状态。OFFLINE/CONNECTION_LOST/ONLINE 是依据最后一次 GPS 上传时间即时算出的，
 * 不是存在 DB 里的栏位；如果这个 Driver 手上有正在进行的 Leg，用 Leg 的状态取代单纯的 ONLINE，
 * 这样 Admin 一眼就能看到「这个人现在在忙什么」而不用切两个画面对照。BREAK 是预留栏位，
 * 目前没有任何流程会产生这个状态。
 */
export type DriverPresenceStatus =
  | "OFFLINE"
  | "CONNECTION_LOST"
  | "ONLINE"
  | "ASSIGNED"
  | "ACCEPTED"
  | "DRIVER_ARRIVING"
  | "PASSENGER_ON_BOARD"
  | "COMPLETED"
  | "BREAK";

interface ComputePresenceInput {
  isOnline: boolean;
  onlineSince: Date | null;
  locationReceivedAt: Date | null;
  activeLegStatus: LegStatus | null;
  now?: Date;
  /** 不传就退回 CONNECTION_LOST_THRESHOLD_SECONDS/AUTO_OFFLINE_THRESHOLD_SECONDS 这两个保底值。 */
  connectionLostThresholdSeconds?: number;
  autoOfflineThresholdSeconds?: number;
}

interface PresenceResult {
  status: DriverPresenceStatus;
  /** 距离最后一次收到 GPS 的秒数；从来没上传过、或目前是 Offline 就是 null。 */
  secondsSinceUpdate: number | null;
}

/**
 * 纯函数，方便写单元测试。GPS 上传失败/装置离线不会抛错、不会影响 Booking——这里只是
 * 单纯地依据「最后一次收到 GPS 的时间」推导出目前该显示什么状态，跟 Leg 的业务逻辑完全分开算，
 * 只在最后用 activeLegStatus 覆盖显示文字。
 */
export function computePresenceStatus(input: ComputePresenceInput): PresenceResult {
  const now = input.now ?? new Date();
  const connectionLostThreshold = input.connectionLostThresholdSeconds ?? CONNECTION_LOST_THRESHOLD_SECONDS;
  const autoOfflineThreshold = input.autoOfflineThresholdSeconds ?? AUTO_OFFLINE_THRESHOLD_SECONDS;

  if (!input.isOnline) {
    return { status: "OFFLINE", secondsSinceUpdate: null };
  }

  const referenceTime = input.locationReceivedAt ?? input.onlineSince;
  const secondsSinceUpdate = referenceTime
    ? Math.max(0, Math.floor((now.getTime() - referenceTime.getTime()) / 1000))
    : null;

  if (secondsSinceUpdate !== null && secondsSinceUpdate > autoOfflineThreshold) {
    return { status: "OFFLINE", secondsSinceUpdate };
  }

  if (secondsSinceUpdate !== null && secondsSinceUpdate > connectionLostThreshold) {
    return { status: "CONNECTION_LOST", secondsSinceUpdate };
  }

  if (input.activeLegStatus) {
    return { status: input.activeLegStatus as DriverPresenceStatus, secondsSinceUpdate };
  }

  return { status: "ONLINE", secondsSinceUpdate };
}

export async function goOnline(driverId: number, actor: AuditActor) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) {
    throw new NotFoundError(`Driver ${driverId} not found`);
  }

  const updated = await prisma.driver.update({
    where: { id: driverId },
    data: { isOnline: true, onlineSince: new Date() }
  });

  await writeAuditLog({
    actor,
    action: "DRIVER_WENT_ONLINE",
    entityType: "Driver",
    entityId: driverId,
    afterData: { isOnline: true }
  });

  return updated;
}

export async function goOffline(driverId: number, actor: AuditActor) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) {
    throw new NotFoundError(`Driver ${driverId} not found`);
  }

  const updated = await prisma.driver.update({
    where: { id: driverId },
    data: { isOnline: false, onlineSince: null }
  });

  await writeAuditLog({
    actor,
    action: "DRIVER_WENT_OFFLINE",
    entityType: "Driver",
    entityId: driverId,
    afterData: { isOnline: false }
  });

  return updated;
}

interface RecordPingInput {
  latitude: number;
  longitude: number;
  speed?: number;
  heading?: number;
  batteryPercent?: number;
  recordedAt?: string;
}

/**
 * GPS 上传独立于 Booking/Leg，这里刻意不碰任何 Leg/Wallet 相关的表——上传失败或 Driver
 * 忘记上线都不该挡住 Complete Leg 这类核心业务操作。只有「必须先 Go Online 才能上传定位」
 * 这一条规则，避免 Offline 状态下还留着一份「看起来是最新」的定位资料造成误判。
 */
export async function recordPing(driverId: number, input: RecordPingInput) {
  if (input.latitude < -90 || input.latitude > 90) {
    throw new ValidationError("latitude must be between -90 and 90");
  }
  if (input.longitude < -180 || input.longitude > 180) {
    throw new ValidationError("longitude must be between -180 and 180");
  }

  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) {
    throw new NotFoundError(`Driver ${driverId} not found`);
  }
  if (!driver.isOnline) {
    throw new ConflictError("Driver must go online before uploading GPS location");
  }

  return prisma.driverLocation.upsert({
    where: { driverId },
    create: {
      driverId,
      latitude: input.latitude,
      longitude: input.longitude,
      speed: input.speed,
      heading: input.heading,
      batteryPercent: input.batteryPercent,
      recordedAt: input.recordedAt ? new Date(input.recordedAt) : new Date()
    },
    update: {
      latitude: input.latitude,
      longitude: input.longitude,
      speed: input.speed,
      heading: input.heading,
      batteryPercent: input.batteryPercent,
      recordedAt: input.recordedAt ? new Date(input.recordedAt) : new Date()
    }
  });
}

const driverSummarySelect = {
  id: true,
  name: true,
  vehiclePlateNumber: true,
  isOnline: true,
  onlineSince: true
} as const;

function toPresencePayload(
  driver: { id: number; name: string; vehiclePlateNumber: string | null; isOnline: boolean; onlineSince: Date | null },
  location: {
    latitude: number;
    longitude: number;
    speed: number | null;
    heading: number | null;
    batteryPercent: number | null;
    recordedAt: Date;
    receivedAt: Date;
  } | null,
  activeLeg: { id: number; bookingId: number; sequence: number; status: LegStatus; booking: { girlName: string } } | null,
  now: Date,
  thresholds: { connectionLostThresholdSeconds: number; autoOfflineThresholdSeconds: number }
) {
  const { status, secondsSinceUpdate } = computePresenceStatus({
    isOnline: driver.isOnline,
    onlineSince: driver.onlineSince,
    locationReceivedAt: location?.receivedAt ?? null,
    activeLegStatus: activeLeg?.status ?? null,
    now,
    connectionLostThresholdSeconds: thresholds.connectionLostThresholdSeconds,
    autoOfflineThresholdSeconds: thresholds.autoOfflineThresholdSeconds
  });

  return {
    driver: { id: driver.id, name: driver.name, vehiclePlateNumber: driver.vehiclePlateNumber },
    status,
    secondsSinceUpdate,
    location: location
      ? {
          latitude: location.latitude,
          longitude: location.longitude,
          speed: location.speed,
          heading: location.heading,
          batteryPercent: location.batteryPercent,
          recordedAt: location.recordedAt,
          receivedAt: location.receivedAt
        }
      : null,
    activeLeg: activeLeg
      ? {
          id: activeLeg.id,
          bookingId: activeLeg.bookingId,
          sequence: activeLeg.sequence,
          status: activeLeg.status,
          bookingGirlName: activeLeg.booking.girlName
        }
      : null
  };
}

/** 每次读取时顺手把「已经超过自动离线门槛、但 DB 里 isOnline 还是 true」的 Driver 打回 false。 */
async function selfHealStaleOnlineDrivers(driverIds: number[]) {
  if (driverIds.length === 0) return;
  // TEMPORARY DEBUG LOGGING（Mobile UAT Bug Fix：诊断真实手机上点了 Go Online 之后
  // presence 还是回报 Offline）：这支函式如果在 goOnline 呼叫的当下就被触发，代表
  // computePresenceStatus 判定「isOnline=true 但已经超过 threshold」，会在同一个 request
  // 里立刻把刚设成 true 的 isOnline 打回 false——这是最可疑的根因，先加 log 确认是否真的
  // 是这条路径在作怪，确认后要整段移除。
  console.log("[PRESENCE_DEBUG] selfHealStaleOnlineDrivers:triggered", JSON.stringify({ driverIds, at: new Date().toISOString() }));
  pushDebugLog("selfHealStaleOnlineDrivers:triggered", { driverIds });
  await prisma.driver.updateMany({
    where: { id: { in: driverIds }, isOnline: true },
    data: { isOnline: false, onlineSince: null }
  });
}

/** 供 gps.service.ts 自己跟 dispatch.service.ts 共用，统一从 CompanySettings 读 presence 阈值。 */
export async function getPresenceThresholds() {
  const settings = await getCompanySettings();
  return {
    connectionLostThresholdSeconds: settings.connectionLostTimeoutSeconds,
    autoOfflineThresholdSeconds: settings.offlineTimeoutSeconds
  };
}

export async function listDriverPresence(onlineOnly: boolean) {
  const now = new Date();
  const thresholds = await getPresenceThresholds();

  const drivers = await prisma.driver.findMany({
    where: { status: "ACTIVE" },
    select: { ...driverSummarySelect, location: true }
  });

  const legs = await prisma.leg.findMany({
    where: { driverId: { in: drivers.map((d) => d.id) }, status: { in: ACTIVE_LEG_STATUSES } },
    include: { booking: { select: { girlName: true } } },
    orderBy: { updatedAt: "desc" }
  });
  const latestActiveLegByDriver = new Map<number, (typeof legs)[number]>();
  for (const leg of legs) {
    if (leg.driverId !== null && !latestActiveLegByDriver.has(leg.driverId)) {
      latestActiveLegByDriver.set(leg.driverId, leg);
    }
  }

  const results = drivers.map((driver) =>
    toPresencePayload(driver, driver.location, latestActiveLegByDriver.get(driver.id) ?? null, now, thresholds)
  );

  const staleOnlineDriverIds = results.filter((r) => r.status === "OFFLINE").map((r) => r.driver.id);
  const staleButFlaggedOnline = drivers
    .filter((d) => d.isOnline && staleOnlineDriverIds.includes(d.id))
    .map((d) => d.id);
  await selfHealStaleOnlineDrivers(staleButFlaggedOnline);

  return onlineOnly ? results.filter((r) => r.status !== "OFFLINE") : results;
}

export async function getDriverPresence(driverId: number) {
  const now = new Date();
  const thresholds = await getPresenceThresholds();

  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { ...driverSummarySelect, location: true }
  });
  if (!driver) {
    throw new NotFoundError(`Driver ${driverId} not found`);
  }

  const activeLeg = await prisma.leg.findFirst({
    where: { driverId, status: { in: ACTIVE_LEG_STATUSES } },
    include: { booking: { select: { girlName: true } } },
    orderBy: { updatedAt: "desc" }
  });

  const payload = toPresencePayload(driver, driver.location, activeLeg, now, thresholds);

  // TEMPORARY DEBUG LOGGING（同上，诊断用，确认根因后移除）：把算 status 用到的每一个原始
  // 输入都印出来——driver.isOnline/onlineSince 是不是真的写进去了、thresholds 是不是被
  // Staging 的 CompanySettings 改成异常小的值、算出来的 secondsSinceUpdate 是多少。
  const debugPayload = {
    driverId,
    dbIsOnline: driver.isOnline,
    dbOnlineSince: driver.onlineSince,
    hasLocation: driver.location !== null,
    locationReceivedAt: driver.location?.receivedAt ?? null,
    thresholds,
    computedStatus: payload.status,
    computedSecondsSinceUpdate: payload.secondsSinceUpdate,
    now: now.toISOString()
  };
  console.log("[PRESENCE_DEBUG] getDriverPresence:computed", JSON.stringify(debugPayload));
  pushDebugLog("getDriverPresence:computed", debugPayload);

  if (payload.status === "OFFLINE" && driver.isOnline) {
    await selfHealStaleOnlineDrivers([driver.id]);
  }

  return payload;
}
