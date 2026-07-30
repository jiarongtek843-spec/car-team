import { prisma } from "../../config/prisma.js";
import { NotFoundError } from "../../common/errors.js";
import { haversineDistanceKm } from "./ranking.js";

/**
 * Driver Matching Engine（NOT Auto Assignment）：给一张 Booking 的上车点，算出最靠近、
 * 目前真的能接单的 Driver 名单，纯粹给 Dispatcher 参考排序用——不会建立 DispatchOffer、
 * 不会自动指派，人工指派（legs.service.ts 的 assignDriver）完全不受影响。
 *
 * 「能接单」直接对应新版 Driver Presence 模块（driverPresence 模块，不是 gps.service.ts
 * 那套旧的 GPS 心跳状态）的 status === AVAILABLE——PENDING_OFFER/ACCEPTED_JOB/ON_TRIP
 * 都代表这个 Driver 已经在忙（Busy），OFFLINE/BREAK 直接排除，一条规则同时满足
 * 「忽略 Offline / 忽略 Busy / 忽略 Break」这三个需求，不需要另外拼装 Eligibility Rule。
 */

/** Booking 可能有多个 Leg（去程/回程/额外行程），这里取最早的一个当作代表性上车点——
 * 跟既有 Dispatch Suggested Drivers（getSuggestedDrivers）用同一个「最早的 Leg」概念，
 * 只是那支是直接给 legId，这支是给 bookingId。 */
async function findReferenceLeg(bookingId: number) {
  return prisma.leg.findFirst({
    where: { bookingId },
    orderBy: { sequence: "asc" }
  });
}

export interface MatchedDriverCandidate {
  rank: number;
  driverId: number;
  driverName: string;
  vehiclePlateNumber: string | null;
  distanceKm: number | null;
  status: "AVAILABLE";
  currentBooking: { id: number; girlName: string } | null;
  lastGpsUpdateAt: Date | null;
}

export async function matchDriversForBooking(bookingId: number) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) {
    throw new NotFoundError(`Booking ${bookingId} not found`);
  }

  const leg = await findReferenceLeg(bookingId);
  const pickupLatitude = leg?.pickupLatitude ?? null;
  const pickupLongitude = leg?.pickupLongitude ?? null;

  const drivers = await prisma.driver.findMany({
    where: {
      status: "ACTIVE",
      presence: { status: "AVAILABLE" }
    },
    select: {
      id: true,
      name: true,
      vehiclePlateNumber: true,
      location: { select: { latitude: true, longitude: true, receivedAt: true } },
      presence: {
        select: {
          currentBooking: { select: { id: true, girlName: true } }
        }
      }
    },
    orderBy: { name: "asc" }
  });

  const withDistance = drivers.map((driver) => {
    const distanceKm =
      pickupLatitude !== null && pickupLongitude !== null && driver.location
        ? haversineDistanceKm(pickupLatitude, pickupLongitude, driver.location.latitude, driver.location.longitude)
        : null;

    return {
      driverId: driver.id,
      driverName: driver.name,
      vehiclePlateNumber: driver.vehiclePlateNumber,
      distanceKm,
      status: "AVAILABLE" as const,
      currentBooking: driver.presence?.currentBooking ?? null,
      lastGpsUpdateAt: driver.location?.receivedAt ?? null
    };
  });

  // 最近的排最前面；没有座标（缺 pickup 座标或缺这个 Driver 的 GPS 定位）的排在最后，
  // 而不是当成距离 0——用 name 当最终 tie-breaker，确保排序结果是确定性的。
  withDistance.sort((a, b) => {
    if (a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
    if (a.distanceKm !== null) return -1;
    if (b.distanceKm !== null) return 1;
    return a.driverName.localeCompare(b.driverName);
  });

  const candidates: MatchedDriverCandidate[] = withDistance.map((c, index) => ({ rank: index + 1, ...c }));

  return {
    bookingId,
    legId: leg?.id ?? null,
    pickupLocation: leg?.pickupLocation ?? null,
    pickupLatitude,
    pickupLongitude,
    candidates
  };
}
