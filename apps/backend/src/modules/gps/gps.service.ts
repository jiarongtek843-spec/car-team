import type { LegStatus } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ConflictError, NotFoundError, ValidationError } from "../../common/errors.js";
import { writeAuditLog, type AuditActor } from "../../common/audit.js";
import { UNFINISHED_LEG_STATUSES } from "../bookings/bookings.status.js";
import { getCompanySettings } from "../companySettings/companySettings.service.js";
import { createActivity } from "../activityLog/activityLog.service.js";
import { getPresenceForDriver } from "../driverPresence/driverPresence.service.js";

/** GPS Foundation：只有司机目前处于这几个「正在跑单」的 Presence 状态，才应该继续上传定位。 */
const LOCATION_REPORTING_STATES = ["AVAILABLE", "PENDING_OFFER", "ACCEPTED_JOB", "ON_TRIP"] as const;

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

  // Mobile UAT Bug Fix（Driver Online 状态在真实手机上点了永远还是回报 Offline，Railway
  // 实测 debug log 抓到的真正根因）：DriverLocation 是「最后已知位置」，Driver 下线之后
  // 不会被清掉——所以一个先前上线过、后来下线的 Driver，DB 里会留着一笔很旧的
  // locationReceivedAt。这里原本无条件优先用 locationReceivedAt 当新鲜度基准
  // （`locationReceivedAt ?? onlineSince`），代表只要有任何位置纪录、不管多旧，都会盖过
  // 刚刚才设的 onlineSince——实测出现过 Driver 刚点击上线（onlineSince 是几毫秒前），
  // 但因为 DB 里还留着一笔 28 小时前的旧定位，直接被算成「28 小时没更新」→ OFFLINE，
  // 而且这个误判会在同一个 request 里透过下面的 self-heal 逻辑把 isOnline 立刻写回
  // false，所以连 goOnline 自己的 API response 都已经是 OFFLINE 了。
  // 修正：只有「这笔定位是在这次上线之后才收到的」（locationReceivedAt >= onlineSince）
  // 才可信、才拿来当新鲜度基准；比 onlineSince 还旧的定位视同「这次上线还没收到任何
  // ping」，用 onlineSince 本身当基准（=刚上线，新鲜），等真的收到这次上线之后的第一个
  // ping，locationReceivedAt 自然会晚于 onlineSince，重新接手当基准。
  const referenceTime =
    input.locationReceivedAt && (!input.onlineSince || input.locationReceivedAt >= input.onlineSince)
      ? input.locationReceivedAt
      : input.onlineSince;
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

  await createActivity({
    module: "GPS",
    activityType: "DRIVER_ONLINE",
    entityType: "Driver",
    entityId: driverId,
    summary: "Driver went online",
    actor: { userId: actor.id },
    subjectDriverId: driverId
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

  await createActivity({
    module: "GPS",
    activityType: "DRIVER_OFFLINE",
    entityType: "Driver",
    entityId: driverId,
    summary: "Driver went offline",
    actor: { userId: actor.id },
    subjectDriverId: driverId
  });

  return updated;
}

interface RecordPingInput {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  batteryPercent?: number;
  recordedAt?: string;
}

/**
 * GPS 上传独立于 Booking/Leg，这里刻意不碰任何 Leg/Wallet 相关的表——上传失败或 Driver
 * 忘记上线都不该挡住 Complete Leg 这类核心业务操作。
 *
 * GPS Foundation：上传门槛从单纯的 `driver.isOnline` 改成检查新的 DriverPresence 模块
 * 的 status——只有 AVAILABLE/PENDING_OFFER/ACCEPTED_JOB/ON_TRIP 这几个「正在跑单」
 * 的状态才允许上传，BREAK（休息中）跟 OFFLINE 一样要挡掉。DriverPresence 是 goOnline/
 * goOffline 透过 Activity Log 订阅同步更新的，比原本单纯的 isOnline boolean 更能反映
 * 司机「现在到底该不该继续回报位置」这件事。
 */
export async function recordPing(driverId: number, input: RecordPingInput) {
  if (input.latitude < -90 || input.latitude > 90) {
    throw new ValidationError("latitude must be between -90 and 90");
  }
  if (input.longitude < -180 || input.longitude > 180) {
    throw new ValidationError("longitude must be between -180 and 180");
  }
  if (input.accuracy !== undefined && input.accuracy < 0) {
    throw new ValidationError("accuracy must not be negative");
  }

  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) {
    throw new NotFoundError(`Driver ${driverId} not found`);
  }

  const presence = await getPresenceForDriver(driverId);
  const status = presence?.status ?? "OFFLINE";
  if (!(LOCATION_REPORTING_STATES as readonly string[]).includes(status)) {
    throw new ConflictError("Driver must be online before uploading GPS location");
  }

  return prisma.driverLocation.upsert({
    where: { driverId },
    create: {
      driverId,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracy: input.accuracy,
      speed: input.speed,
      heading: input.heading,
      batteryPercent: input.batteryPercent,
      recordedAt: input.recordedAt ? new Date(input.recordedAt) : new Date()
    },
    update: {
      latitude: input.latitude,
      longitude: input.longitude,
      accuracy: input.accuracy,
      speed: input.speed,
      heading: input.heading,
      batteryPercent: input.batteryPercent,
      recordedAt: input.recordedAt ? new Date(input.recordedAt) : new Date()
    }
  });
}

/**
 * GPS Foundation：Admin Get Driver Locations API 的核心逻辑——只回传「latest location」，
 * 不含 presence/activeLeg 那些既有 Dashboard 才需要的合并资讯（那份合并逻辑留给既有的
 * listDriverPresence/getDriverPresence，避免重复维护两套 payload）。只列出目前仍在
 * 报点状态（AVAILABLE/PENDING_OFFER/ACCEPTED_JOB/ON_TRIP）且有位置纪录的司机。
 */
export async function getDriverLocations() {
  const drivers = await prisma.driver.findMany({
    where: {
      status: "ACTIVE",
      location: { isNot: null },
      presence: { status: { in: [...LOCATION_REPORTING_STATES] } }
    },
    select: {
      id: true,
      name: true,
      location: {
        select: { latitude: true, longitude: true, accuracy: true, receivedAt: true }
      }
    },
    orderBy: { name: "asc" }
  });

  return drivers
    .filter((driver) => driver.location !== null)
    .map((driver) => ({
      driverId: driver.id,
      driverName: driver.name,
      latitude: driver.location!.latitude,
      longitude: driver.location!.longitude,
      accuracy: driver.location!.accuracy,
      updatedAt: driver.location!.receivedAt
    }));
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

  // Mobile UAT Round 2 Bug Fix：这里要找的是「手上还没做完的工作」，用来在 Presence
  // 徽章上叠加显示 ACCEPTED/DRIVER_ARRIVING 等进行中状态。之前误用 ACTIVE_LEG_STATUSES
  // （刻意包含 COMPLETED，是给 Booking Status 推导用的），导致一个 Driver 刚完成一趟
  // 行程、还没接到下一趟时，presence 状态会被这笔「已完成」的 Leg 盖过去，明明是 Online
  // 却显示 Completed。改用 UNFINISHED_LEG_STATUSES（不含 COMPLETED）。
  const legs = await prisma.leg.findMany({
    where: { driverId: { in: drivers.map((d) => d.id) }, status: { in: UNFINISHED_LEG_STATUSES } },
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
    where: { driverId, status: { in: UNFINISHED_LEG_STATUSES } },
    include: { booking: { select: { girlName: true } } },
    orderBy: { updatedAt: "desc" }
  });

  const payload = toPresencePayload(driver, driver.location, activeLeg, now, thresholds);

  if (payload.status === "OFFLINE" && driver.isOnline) {
    await selfHealStaleOnlineDrivers([driver.id]);
  }

  return payload;
}
