import type { BookingStatus, CommissionType, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ConflictError, NotFoundError, ValidationError } from "../../common/errors.js";
import { deriveBookingStatus } from "./bookings.status.js";
import { calculateCommissionSplit } from "./commission.js";
import { getAllocatedSumCents, hasEarningHistory } from "./allocation.js";
import { getCompanySettings } from "../companySettings/companySettings.service.js";
import { writeAuditLog, type AuditActor } from "../../common/audit.js";
import {
  createBookingChargeWithClient,
  listBookingCharges,
  type TxClient
} from "../bookingCharges/bookingCharge.service.js";

const FARE_CHARGE_TYPE_KEY = "FARE";

export const bookingDetailInclude = {
  legs: {
    orderBy: { sequence: "asc" },
    include: { driver: true }
  }
} satisfies Prisma.BookingInclude;

interface ListBookingsParams {
  status?: BookingStatus;
  search?: string;
  page: number;
  pageSize: number;
}

export async function listBookings({ status, search, page, pageSize }: ListBookingsParams) {
  const where: Prisma.BookingWhereInput = {
    status,
    ...(search ? { girlName: { contains: search, mode: "insensitive" } } : {})
  };

  const [data, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      include: { legs: { select: { status: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.booking.count({ where })
  ]);

  return { data, total, page, pageSize };
}

export async function getBookingById(id: number) {
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: bookingDetailInclude
  });

  if (!booking) {
    throw new NotFoundError(`Booking ${id} not found`);
  }

  const charges = await listBookingCharges(id);
  return { ...booking, charges };
}

interface CreateLegInput {
  pickupLocation?: string;
  dropoffLocation?: string;
  scheduledAt?: string;
  driverId?: number;
  notes?: string;
  earningAllocationCents?: number;
}

interface CreateBookingInput {
  girlName: string;
  notes?: string;
  totalAmountCents?: number;
  commissionType?: CommissionType;
  commissionValue?: number;
  legs?: CreateLegInput[];
}

function sumAllocations(legs: CreateLegInput[]) {
  return legs.reduce((sum, leg) => sum + (leg.earningAllocationCents ?? 0), 0);
}

export async function createBooking(input: CreateBookingInput, actor: AuditActor | null = null) {
  const totalAmountCents = input.totalAmountCents ?? 0;

  let commissionType = input.commissionType;
  let commissionValue = input.commissionValue;
  if (!commissionType || commissionValue === undefined) {
    const settings = await getCompanySettings();
    commissionType ??= settings.defaultCommissionType;
    commissionValue ??= settings.defaultCommissionValue;
  }

  const { platformAmountCents, driverPoolAmountCents } = calculateCommissionSplit(
    totalAmountCents,
    commissionType,
    commissionValue
  );

  const legs = input.legs ?? [];
  for (const leg of legs) {
    if (leg.earningAllocationCents !== undefined && leg.earningAllocationCents < 0) {
      throw new ValidationError("earningAllocationCents cannot be negative");
    }
  }
  if (sumAllocations(legs) > driverPoolAmountCents) {
    throw new ValidationError(
      `Total leg allocation exceeds driver pool (RM${(driverPoolAmountCents / 100).toFixed(2)})`
    );
  }

  const booking = await prisma.$transaction(async (tx) => {
    const created = await tx.booking.create({
      data: {
        girlName: input.girlName,
        notes: input.notes,
        // Customer Fare 现在由下面建立的 FARE BookingCharge 决定，这里先建成 0，
        // 建立 Charge 时会透过 recalculateBookingTotal 写回正确值（database-schema-v2.md）。
        totalAmountCents: 0,
        platformCommissionType: commissionType,
        platformCommissionValue: commissionValue,
        platformAmountCents,
        driverPoolAmountCents,
        legs: legs.length
          ? {
              create: legs.map((leg, index) => ({
                sequence: index + 1,
                pickupLocation: leg.pickupLocation,
                dropoffLocation: leg.dropoffLocation,
                scheduledAt: leg.scheduledAt ? new Date(leg.scheduledAt) : undefined,
                driverId: leg.driverId,
                notes: leg.notes,
                earningAllocationCents: leg.earningAllocationCents
              }))
            }
          : undefined
      },
      include: bookingDetailInclude
    });

    if (totalAmountCents > 0) {
      const fareChargeType = await tx.chargeType.findUniqueOrThrow({ where: { key: FARE_CHARGE_TYPE_KEY } });
      await createBookingChargeWithClient(
        tx,
        { bookingId: created.id, chargeTypeId: fareChargeType.id, amountCents: totalAmountCents, description: "Customer Fare" },
        actor
      );
    }

    return created;
  });

  if (booking.legs.length > 0) {
    return recalculateBookingStatus(booking.id);
  }

  return getBookingById(booking.id);
}

interface UpdateBookingInput {
  girlName?: string;
  notes?: string;
  totalAmountCents?: number;
  commissionType?: CommissionType;
  commissionValue?: number;
}

const COMMISSION_FIELDS = ["totalAmountCents", "commissionType", "commissionValue"] as const;

/**
 * 把 Customer Fare 的变化换算成一笔 BookingCharge 调整，而不是直接改 Booking row：
 * 已经有 FARE 原始 Charge → 对它建立差额 ADDITION（可正可负）；还没有（例如原本是 0 元的
 * Booking）→ 直接建立原始 FARE Charge。newTotalCents 跟目前净额相同就整个跳过，不留下
 * 一笔金额是 0 的多余记录。
 */
async function applyTotalAmountChange(
  tx: TxClient,
  bookingId: number,
  currentTotalCents: number,
  newTotalCents: number,
  actor: AuditActor | null
) {
  const delta = newTotalCents - currentTotalCents;
  if (delta === 0) return;

  const fareChargeType = await tx.chargeType.findUniqueOrThrow({ where: { key: FARE_CHARGE_TYPE_KEY } });
  const existingFare = await tx.bookingCharge.findFirst({
    where: { bookingId, chargeTypeId: fareChargeType.id, adjustmentType: "NONE" },
    orderBy: { createdAt: "asc" }
  });

  if (!existingFare) {
    if (newTotalCents <= 0) return;
    await createBookingChargeWithClient(
      tx,
      { bookingId, chargeTypeId: fareChargeType.id, amountCents: newTotalCents, description: "Customer Fare" },
      actor
    );
    return;
  }

  await createBookingChargeWithClient(
    tx,
    {
      bookingId,
      chargeTypeId: fareChargeType.id,
      amountCents: delta,
      adjustsChargeId: existingFare.id,
      adjustmentReason: `Booking Edit: total adjusted from RM${(currentTotalCents / 100).toFixed(2)} to RM${(
        newTotalCents / 100
      ).toFixed(2)}`
    },
    actor
  );
}

export async function updateBooking(id: number, input: UpdateBookingInput, actor: AuditActor | null) {
  const booking = await getBookingById(id);

  const touchesCommission = COMMISSION_FIELDS.some((field) => input[field] !== undefined);

  const data: Prisma.BookingUpdateInput = {
    girlName: input.girlName,
    notes: input.notes
  };

  let auditSnapshot: { before: unknown; after: unknown } | undefined;
  let totalAmountCents = booking.totalAmountCents;

  if (touchesCommission) {
    if (await hasEarningHistory(id)) {
      throw new ConflictError(
        "This booking already has completed legs or wallet transactions; total amount and commission can no longer be changed"
      );
    }

    totalAmountCents = input.totalAmountCents ?? booking.totalAmountCents;
    const commissionType = input.commissionType ?? booking.platformCommissionType;
    const commissionValue = input.commissionValue ?? booking.platformCommissionValue;

    const { platformAmountCents, driverPoolAmountCents } = calculateCommissionSplit(
      totalAmountCents,
      commissionType,
      commissionValue
    );

    const allocatedSum = await getAllocatedSumCents(id);
    if (allocatedSum > driverPoolAmountCents) {
      throw new ValidationError(
        `Existing leg allocations (RM${(allocatedSum / 100).toFixed(2)}) exceed the new driver pool (RM${(
          driverPoolAmountCents / 100
        ).toFixed(2)})`
      );
    }

    data.platformCommissionType = commissionType;
    data.platformCommissionValue = commissionValue;
    data.platformAmountCents = platformAmountCents;
    data.driverPoolAmountCents = driverPoolAmountCents;

    auditSnapshot = {
      before: {
        totalAmountCents: booking.totalAmountCents,
        platformCommissionType: booking.platformCommissionType,
        platformCommissionValue: booking.platformCommissionValue,
        platformAmountCents: booking.platformAmountCents,
        driverPoolAmountCents: booking.driverPoolAmountCents
      },
      after: {
        totalAmountCents,
        platformCommissionType: commissionType,
        platformCommissionValue: commissionValue,
        platformAmountCents,
        driverPoolAmountCents
      }
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({ where: { id }, data, include: bookingDetailInclude });

    if (touchesCommission && totalAmountCents !== booking.totalAmountCents) {
      await applyTotalAmountChange(tx, id, booking.totalAmountCents, totalAmountCents, actor);
    }
  });

  if (auditSnapshot) {
    await writeAuditLog({
      actor,
      action: "BOOKING_COMMISSION_UPDATE",
      entityType: "Booking",
      entityId: id,
      beforeData: auditSnapshot.before,
      afterData: auditSnapshot.after
    });
  }

  return getBookingById(id);
}

export async function cancelBooking(id: number) {
  await getBookingById(id);

  await prisma.$transaction([
    prisma.leg.updateMany({
      where: {
        bookingId: id,
        status: { in: ["PENDING", "ASSIGNED", "ACCEPTED", "DRIVER_ARRIVING", "PASSENGER_ON_BOARD", "REJECTED"] }
      },
      data: { status: "CANCELLED" }
    }),
    prisma.booking.update({
      where: { id },
      // 取消 Booking 同步把 Financial Status 收敛成 VOIDED（financial-model-v2.md 的
      // Booking Financial Status Flow）；Charge 本身不动——已经开出的 Fare 是历史事实，
      // 是否需要退款是另一个尚未设计的 Future Scenario，不在这次范围内。
      data: { status: "CANCELLED", financialStatus: "VOIDED" }
    })
  ]);

  return getBookingById(id);
}

/**
 * 根据当下所有 Leg 重算 booking.status 并写回 DB（若有变化）。
 * 每次 Leg 新增/状态变动后都要调用。
 */
export async function recalculateBookingStatus(bookingId: number) {
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { legs: { select: { status: true } } }
  });

  const nextStatus = deriveBookingStatus(booking.status, booking.legs);

  if (nextStatus !== booking.status) {
    await prisma.booking.update({ where: { id: bookingId }, data: { status: nextStatus } });
  }

  return getBookingById(bookingId);
}
