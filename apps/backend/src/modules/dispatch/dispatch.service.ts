import type { LegStatus, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { UNFINISHED_LEG_STATUSES } from "../bookings/bookings.status.js";
import { computePresenceStatus, getPresenceThresholds, type DriverPresenceStatus } from "../gps/gps.service.js";
import { parseLocalDateOnly, startOfLocalDay } from "../../common/date.js";
import { NotFoundError } from "../../common/errors.js";
import { findEligibleDrivers, type EligibilityCandidateDriver } from "./eligibility.js";
import { rankDrivers, type RankingCandidateDriver } from "./ranking.js";

/**
 * Dispatch Center 是纯读取的聚合画面，直接组合既有 Module 的资料（Booking/Leg、Driver、
 * DriverLocation）算出 Dispatcher 要看的视图，不碰任何一个既有 Module 的表结构或写入逻辑。
 * 唯一的写入动作（Assign/Reassign）直接复用 Module 1/2 既有的 assignDriver API，这里完全
 * 不重新实现指派逻辑。
 */

export type BookingDispatchFilter = "WAITING" | "ASSIGNED" | "ACCEPTED" | "IN_PROGRESS" | "COMPLETED";
export type DriverDispatchFilter = "ONLINE" | "OFFLINE" | "CONNECTION_LOST" | "BUSY" | "IDLE";
export type DispatchPriority = "NORMAL" | "HIGH" | "URGENT";

/** Reject 之后的 Leg 功能上等于「又要重新等派车」，跟 PENDING 一起算 Waiting。 */
const WAITING_STATUSES: LegStatus[] = ["PENDING", "REJECTED"];
const IN_PROGRESS_STATUSES: LegStatus[] = ["DRIVER_ARRIVING", "PASSENGER_ON_BOARD"];
/** Dispatch Center 左边列表默认显示的全部状态：还没结束、Dispatcher 可能需要处理的 Leg。 */
const DISPATCH_VISIBLE_STATUSES: LegStatus[] = [
  "PENDING",
  "REJECTED",
  "ASSIGNED",
  "ACCEPTED",
  "DRIVER_ARRIVING",
  "PASSENGER_ON_BOARD"
];

function localDayRange(date: Date) {
  const start = startOfLocalDay(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { gte: start, lt: end };
}

/**
 * 目前没有真正的 Priority 栏位（Module 1 的 Booking 没有这个概念，刻意不去改动那个已完成的
 * Module），改用「这张 Booking 建立多久了还没派车」当作 Priority 的替代讯号——等越久越急，
 * 这对 Dispatcher 来说其实是更直接可用的排序依据。
 */
function derivePriority(bookingCreatedAt: Date, now: Date): DispatchPriority {
  const minutesWaiting = (now.getTime() - bookingCreatedAt.getTime()) / 60000;
  if (minutesWaiting >= 30) return "URGENT";
  if (minutesWaiting >= 10) return "HIGH";
  return "NORMAL";
}

function statusesForBookingFilter(filter: BookingDispatchFilter | undefined): LegStatus[] {
  switch (filter) {
    case "WAITING":
      return WAITING_STATUSES;
    case "ASSIGNED":
      return ["ASSIGNED"];
    case "ACCEPTED":
      return ["ACCEPTED"];
    case "IN_PROGRESS":
      return IN_PROGRESS_STATUSES;
    case "COMPLETED":
      return ["COMPLETED"];
    default:
      return DISPATCH_VISIBLE_STATUSES;
  }
}

interface ListWaitingBookingsParams {
  filter?: BookingDispatchFilter;
  search?: string;
  /** 只在 filter === "COMPLETED" 时有意义：要看哪一天完成的 Leg，YYYY-MM-DD，默认今天。 */
  date?: string;
}

export async function listWaitingBookings({ filter, search, date }: ListWaitingBookingsParams) {
  const trimmedSearch = search?.trim();
  const searchAsId = trimmedSearch && /^\d+$/.test(trimmedSearch) ? Number(trimmedSearch) : undefined;

  const where: Prisma.LegWhereInput = {
    status: { in: statusesForBookingFilter(filter) },
    booking: trimmedSearch
      ? {
          OR: [
            { girlName: { contains: trimmedSearch, mode: "insensitive" } },
            ...(searchAsId !== undefined ? [{ id: searchAsId }] : [])
          ]
        }
      : undefined,
    // Bug Fix（UAT 稳定化阶段）：`date` 是 "YYYY-MM-DD" 字串，直接丢给 `new Date(date)`
    // 会被当成 UTC 午夜解析，再用 localDayRange 的本地时区运算，会跟 settlement.service.ts
    // 已经修过的「UTC 解析 + 本地时区运算混用」是同一个坑——伺服器时区不是 UTC 时，
    // 「今天完成的」筛选可能会跟真正的本地日历日期差一天。改用 parseLocalDateOnly 直接照
    // Y/M/D 数字组本地时间的 Date，不经过 UTC 解析。
    ...(filter === "COMPLETED" ? { completedAt: localDayRange(date ? parseLocalDateOnly(date) : new Date()) } : {})
  };

  const legs = await prisma.leg.findMany({
    where,
    include: {
      booking: { select: { id: true, girlName: true, status: true, createdAt: true } },
      driver: { select: { id: true, name: true, vehiclePlateNumber: true } }
    },
    orderBy:
      filter === "COMPLETED"
        ? [{ completedAt: "desc" }]
        : [{ booking: { createdAt: "asc" } }, { sequence: "asc" }],
    take: 500
  });

  const now = new Date();

  return legs.map((leg) => ({
    legId: leg.id,
    bookingId: leg.bookingId,
    girlName: leg.booking.girlName,
    bookingStatus: leg.booking.status,
    sequence: leg.sequence,
    legType: leg.legType,
    pickupLocation: leg.pickupLocation,
    dropoffLocation: leg.dropoffLocation,
    // Live Dispatch Map：这两个栏位本来就已经跟着 leg 一起查出来了，这里只是把既有资料
    // 多带出去，不是新查询——地图用它来画 Booking Pickup Marker（缺座标就不画）。
    pickupLatitude: leg.pickupLatitude,
    pickupLongitude: leg.pickupLongitude,
    scheduledAt: leg.scheduledAt,
    completedAt: leg.completedAt,
    bookingCreatedAt: leg.booking.createdAt,
    priority: derivePriority(leg.booking.createdAt, now),
    status: leg.status,
    rejectionReason: leg.rejectionReason,
    driver: leg.driver
  }));
}

interface ListDispatchDriversParams {
  filter?: DriverDispatchFilter;
  search?: string;
}

const GPS_FILTER_STATUSES: DriverPresenceStatus[] = ["ONLINE", "OFFLINE", "CONNECTION_LOST"];

export async function listDispatchDrivers({ filter, search }: ListDispatchDriversParams) {
  const trimmedSearch = search?.trim();

  const drivers = await prisma.driver.findMany({
    where: {
      status: "ACTIVE",
      ...(trimmedSearch
        ? {
            OR: [
              { name: { contains: trimmedSearch, mode: "insensitive" as const } },
              { phone: { contains: trimmedSearch, mode: "insensitive" as const } }
            ]
          }
        : {})
    },
    include: { location: true },
    orderBy: { name: "asc" }
  });

  const driverIds = drivers.map((d) => d.id);
  const todayStart = startOfLocalDay(new Date());

  const [thresholds, workloadGroups, pendingGroups, completedTodayGroups] = await Promise.all([
    getPresenceThresholds(),
    prisma.leg.groupBy({
      by: ["driverId"],
      where: { driverId: { in: driverIds }, status: { in: UNFINISHED_LEG_STATUSES } },
      _count: { _all: true }
    }),
    prisma.leg.groupBy({
      by: ["driverId"],
      where: { driverId: { in: driverIds }, status: "ASSIGNED" },
      _count: { _all: true }
    }),
    prisma.leg.groupBy({
      by: ["driverId"],
      where: { driverId: { in: driverIds }, status: "COMPLETED", completedAt: { gte: todayStart } },
      _count: { _all: true }
    })
  ]);

  const currentJobsByDriver = new Map(workloadGroups.map((g) => [g.driverId, g._count._all]));
  const pendingJobsByDriver = new Map(pendingGroups.map((g) => [g.driverId, g._count._all]));
  const completedTodayByDriver = new Map(completedTodayGroups.map((g) => [g.driverId, g._count._all]));

  const now = new Date();

  const results = drivers.map((driver) => {
    const currentJobs = currentJobsByDriver.get(driver.id) ?? 0;
    const pendingJobs = pendingJobsByDriver.get(driver.id) ?? 0;
    const completedToday = completedTodayByDriver.get(driver.id) ?? 0;

    // 刻意传 activeLegStatus: null——Dispatch Center 的 GPS 栏位要的是单纯的 Online/Offline/
    // Connection Lost，跟「目前工作数」分开显示两个栏位，不像 GPS Dashboard 那样把两者合并。
    const { status: gpsStatus, secondsSinceUpdate } = computePresenceStatus({
      isOnline: driver.isOnline,
      onlineSince: driver.onlineSince,
      locationReceivedAt: driver.location?.receivedAt ?? null,
      activeLegStatus: null,
      connectionLostThresholdSeconds: thresholds.connectionLostThresholdSeconds,
      now
    });

    return {
      driver: { id: driver.id, name: driver.name, phone: driver.phone, vehiclePlateNumber: driver.vehiclePlateNumber },
      gpsStatus: gpsStatus as "ONLINE" | "OFFLINE" | "CONNECTION_LOST",
      secondsSinceUpdate,
      location: driver.location
        ? { latitude: driver.location.latitude, longitude: driver.location.longitude }
        : null,
      currentJobs,
      pendingJobs,
      completedToday,
      workloadStatus: currentJobs > 0 ? ("BUSY" as const) : ("IDLE" as const)
    };
  });

  if (!filter) {
    return results;
  }

  if (GPS_FILTER_STATUSES.includes(filter as DriverPresenceStatus)) {
    return results.filter((r) => r.gpsStatus === filter);
  }
  return results.filter((r) => r.workloadStatus === filter);
}

export async function getDispatchStatistics() {
  const todayStart = startOfLocalDay(new Date());

  const [waitingBookings, assigned, accepted, inProgress, completedToday, onlineDrivers, totalActiveDrivers] =
    await Promise.all([
      prisma.leg.count({ where: { status: { in: WAITING_STATUSES } } }),
      prisma.leg.count({ where: { status: "ASSIGNED" } }),
      prisma.leg.count({ where: { status: "ACCEPTED" } }),
      prisma.leg.count({ where: { status: { in: IN_PROGRESS_STATUSES } } }),
      prisma.leg.count({ where: { status: "COMPLETED", completedAt: { gte: todayStart } } }),
      // 这里刻意直接用 isOnline 旗标做快速 count，不逐笔重新计算 presence（100+ Driver 时
      // 效能考量）；极少数「已经超过自动离线门槛但还没被读取自愈」的 Driver 短暂算成 Online，
      // 只要有人打开 GPS Dashboard 或 Dispatch Driver List 就会自动修正，不影响正确性。
      prisma.driver.count({ where: { status: "ACTIVE", isOnline: true } }),
      prisma.driver.count({ where: { status: "ACTIVE" } })
    ]);

  return {
    waitingBookings,
    assigned,
    accepted,
    inProgress,
    completedToday,
    onlineDrivers,
    offlineDrivers: totalActiveDrivers - onlineDrivers
  };
}

interface SuggestedDriverCandidate extends EligibilityCandidateDriver, RankingCandidateDriver {
  name: string;
  vehiclePlateNumber: string | null;
  gpsStatus: DriverPresenceStatus;
  secondsSinceUpdate: number | null;
  completedToday: number;
}

/**
 * Phase 1 Driver Eligibility + Ranking Engine（docs/design/phase2-gps-dispatch-architecture.md
 * §3.1/§3.2）：给一个还在等车的 Leg，回传「排序好、只剩合格 Driver」的建议名单，纯粹给
 * Dispatcher 参考——不建立 DispatchOffer、不自动指派，人工指派（assignDriver）完全不受
 * 影响，一直都在。Leg 目前没有上车点坐标栏位，所以距离排序目前一定会是 null、整批退回
 * 「今日已完成趟数由少到多」这个 tie-breaker，等 §6.7 的坐标栏位补上之后才会真的按距离排。
 */
export async function getSuggestedDrivers(legId: number) {
  const leg = await prisma.leg.findUnique({
    where: { id: legId },
    include: { booking: { select: { id: true, girlName: true } } }
  });
  if (!leg) {
    throw new NotFoundError(`Leg ${legId} not found`);
  }

  const drivers = await listDispatchDrivers({});
  const candidates: SuggestedDriverCandidate[] = drivers.map((d) => ({
    id: d.driver.id,
    name: d.driver.name,
    vehiclePlateNumber: d.driver.vehiclePlateNumber,
    // listDispatchDrivers 的查询本身已经限定 status === "ACTIVE"，这里维持显式字段只是
    // 让 ACTIVE_STATUS 这条 Rule 可以脱离这支 API 单独测试。
    status: "ACTIVE",
    presenceStatus: d.gpsStatus,
    gpsStatus: d.gpsStatus,
    workloadStatus: d.workloadStatus,
    secondsSinceUpdate: d.secondsSinceUpdate,
    completedToday: d.completedToday,
    latitude: d.location?.latitude ?? null,
    longitude: d.location?.longitude ?? null
  }));

  const eligible = findEligibleDrivers(candidates, { excludeDriverIds: [] });
  const ranked = rankDrivers(eligible, { pickupLatitude: null, pickupLongitude: null });

  return {
    legId: leg.id,
    bookingId: leg.bookingId,
    girlName: leg.booking.girlName,
    pickupLocation: leg.pickupLocation,
    dropoffLocation: leg.dropoffLocation,
    suggestions: ranked.map((r, index) => ({
      rank: index + 1,
      driver: { id: r.candidate.id, name: r.candidate.name, vehiclePlateNumber: r.candidate.vehiclePlateNumber },
      distanceKm: r.distanceKm,
      gpsStatus: r.candidate.gpsStatus,
      secondsSinceUpdate: r.candidate.secondsSinceUpdate,
      completedToday: r.candidate.completedToday
    }))
  };
}
