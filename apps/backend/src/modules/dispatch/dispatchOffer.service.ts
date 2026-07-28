/**
 * Phase 1 Dispatch Engine（docs/design/phase2-gps-dispatch-architecture.md §3.3，
 * 2026-07 简化版——按用户明确要求，不做 Wave/Round/Policy）。
 *
 * 流程只有五步，刻意没有更多：
 *   1. Dispatcher 对一笔还在等派车的 Leg 按「Send Offer」。
 *   2. 当下所有合格 Driver（Eligibility Engine）同时收到 Offer，不分批。
 *   3. 第一个 Accept 的赢——用 applyLegTransition 同一套「条件式 UPDATE」保证原子性。
 *   4. 赢家产生的同一个 Transaction 里，其余还是 PENDING 的 Offer 立刻关闭（EXPIRED）。
 *   5. 逾时没人 Accept：整批变 EXPIRED，Leg 保持在既有的 Waiting Bookings 名单，
 *      交回 Dispatcher——不会自动重送第二轮，要重送是 Dispatcher 自己再按一次。
 */
import { prisma } from "../../config/prisma.js";
import { ConflictError, NotFoundError } from "../../common/errors.js";
import { writeAuditLog, type AuditActor } from "../../common/audit.js";
import { getCompanySettings } from "../companySettings/companySettings.service.js";
import { applyLegTransition } from "../bookings/legTransition.js";
import { recalculateBookingStatus } from "../bookings/bookings.service.js";
import { findEligibleDrivers } from "./eligibility.js";
import { rankDrivers } from "./ranking.js";
import { listDispatchDrivers } from "./dispatch.service.js";

/** Leg 处在这两个状态才算「还在等派车」，跟 dispatch.service.ts 的 WAITING_STATUSES 是同一个概念。 */
const WAITING_LEG_STATUSES = ["PENDING", "REJECTED"] as const;

export async function sendOffer(legId: number, actor: AuditActor) {
  const leg = await prisma.leg.findUnique({ where: { id: legId } });
  if (!leg) {
    throw new NotFoundError(`Leg ${legId} not found`);
  }
  if (!(WAITING_LEG_STATUSES as readonly string[]).includes(leg.status)) {
    throw new ConflictError(
      `Leg is currently ${leg.status} — can only send an offer while it's waiting for a driver`
    );
  }

  const now = new Date();
  const activePending = await prisma.dispatchOffer.count({
    where: { legId, status: "PENDING", expiresAt: { gt: now } }
  });
  if (activePending > 0) {
    throw new ConflictError("This job already has offers out — wait for them to resolve before sending again");
  }

  const drivers = await listDispatchDrivers({});
  const candidates = drivers.map((d) => ({
    id: d.driver.id,
    // listDispatchDrivers 本身已经限定 status === "ACTIVE"，见 eligibility.ts 的说明。
    status: "ACTIVE" as const,
    presenceStatus: d.gpsStatus,
    workloadStatus: d.workloadStatus,
    completedToday: d.completedToday,
    latitude: d.location?.latitude ?? null,
    longitude: d.location?.longitude ?? null
  }));

  const eligible = findEligibleDrivers(candidates, { excludeDriverIds: [] });
  if (eligible.length === 0) {
    throw new ConflictError("No eligible drivers are online right now — assign manually instead");
  }

  const ranked = rankDrivers(eligible, { pickupLatitude: null, pickupLongitude: null });
  const settings = await getCompanySettings();
  const expiresAt = new Date(now.getTime() + settings.dispatchOfferTimeoutSeconds * 1000);

  const offers = await prisma.$transaction(
    ranked.map((r) =>
      prisma.dispatchOffer.create({
        data: { legId, driverId: r.candidate.id, distanceKm: r.distanceKm, expiresAt },
        include: { driver: { select: { id: true, name: true, vehiclePlateNumber: true } } }
      })
    )
  );

  await writeAuditLog({
    actor,
    action: "DISPATCH_OFFER_SENT",
    entityType: "Leg",
    entityId: legId,
    afterData: { driverIds: ranked.map((r) => r.candidate.id), expiresAt: expiresAt.toISOString() }
  });

  return offers;
}

export function listOffersForLeg(legId: number) {
  return prisma.dispatchOffer.findMany({
    where: { legId },
    include: { driver: { select: { id: true, name: true, vehiclePlateNumber: true } } },
    orderBy: { offeredAt: "desc" }
  });
}

export function listMyPendingOffers(driverId: number) {
  const now = new Date();
  return prisma.dispatchOffer.findMany({
    where: { driverId, status: "PENDING", expiresAt: { gt: now } },
    include: { leg: { include: { booking: { select: { id: true, girlName: true } } } } },
    orderBy: { offeredAt: "asc" }
  });
}

async function getOwnedPendingOffer(driverId: number, offerId: number) {
  const offer = await prisma.dispatchOffer.findFirst({ where: { id: offerId, driverId } });
  if (!offer) {
    throw new NotFoundError(`Offer ${offerId} not found`);
  }
  return offer;
}

/**
 * 核心规则 #8「第一个 Accept 的赢」+ 核心规则 #5「其他 Offer 自动关闭」。两件事在
 * 同一个 Transaction 里做完：赢的判定跟既有 applyLegTransition 用一模一样的条件式
 * UPDATE（WHERE status='PENDING' AND expiresAt > now），Leg 指派失败就整个 Transaction
 * 回滚，Offer 也不会被误判成 Accepted。
 */
export async function acceptOffer(driverId: number, offerId: number) {
  await getOwnedPendingOffer(driverId, offerId);
  const now = new Date();

  const leg = await prisma.$transaction(async (tx) => {
    const result = await tx.dispatchOffer.updateMany({
      where: { id: offerId, driverId, status: "PENDING", expiresAt: { gt: now } },
      data: { status: "ACCEPTED", respondedAt: now }
    });
    if (result.count !== 1) {
      throw new ConflictError("This job is no longer available");
    }

    const offer = await tx.dispatchOffer.findUniqueOrThrow({ where: { id: offerId } });

    const updatedLeg = await applyLegTransition({
      legId: offer.legId,
      // 不传 driverId 当筛选条件——这段 Leg 此时还没有指派给任何 Driver（driverId 是
      // null），传了反而会让 WHERE driverId=X 永远匹配不到、条件式 UPDATE 直接失败。
      // 这里的 driverId 是「赢家是谁」，靠 data.driverId 写进去，不是拿来验证归属。
      fromStatuses: [...WAITING_LEG_STATUSES],
      data: {
        driverId,
        status: "ASSIGNED",
        assignedAt: now,
        acceptedAt: null,
        driverArrivingAt: null,
        passengerOnBoardAt: null,
        rejectedAt: null,
        rejectionReason: null
      },
      client: tx
    });

    await tx.dispatchOffer.updateMany({
      where: { legId: offer.legId, status: "PENDING", id: { not: offerId } },
      data: { status: "EXPIRED", respondedAt: now }
    });

    return updatedLeg;
  });

  await recalculateBookingStatus(leg.bookingId);
  return leg;
}

export async function declineOffer(driverId: number, offerId: number) {
  await getOwnedPendingOffer(driverId, offerId);
  const result = await prisma.dispatchOffer.updateMany({
    where: { id: offerId, driverId, status: "PENDING" },
    data: { status: "DECLINED", respondedAt: new Date() }
  });
  if (result.count !== 1) {
    throw new ConflictError("This offer is no longer available");
  }
}

/**
 * 核心规则 #10「逾时没人 Accept，退回 Dispatcher」的另一半——把逾时的 PENDING Offer
 * 标成 EXPIRED，纯粹是记录状态用，不会触发任何重新派车。Leg 本来就还停在 Waiting
 * Bookings 名单里，这个 Sweep 跑不跑都不影响 Dispatcher 看得到、能手动处理。
 */
export async function sweepExpiredOffers() {
  const result = await prisma.dispatchOffer.updateMany({
    where: { status: "PENDING", expiresAt: { lte: new Date() } },
    data: { status: "EXPIRED" }
  });
  return result.count;
}
