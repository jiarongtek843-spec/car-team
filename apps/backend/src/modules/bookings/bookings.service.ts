import type { BookingStatus, CommissionType, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ConflictError, NotFoundError, ValidationError } from "../../common/errors.js";
import { deriveBookingStatus } from "./bookings.status.js";
import { calculateCommissionSplit } from "./commission.js";
import { getAllocatedSumCents, hasEarningHistory } from "./allocation.js";
import { getCompanySettings } from "../companySettings/companySettings.service.js";
import { writeAuditLog, type AuditActor } from "../../common/audit.js";

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

  return booking;
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

export async function createBooking(input: CreateBookingInput) {
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

  const booking = await prisma.booking.create({
    data: {
      girlName: input.girlName,
      notes: input.notes,
      totalAmountCents,
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

  if (booking.legs.length > 0) {
    return recalculateBookingStatus(booking.id);
  }

  return booking;
}

interface UpdateBookingInput {
  girlName?: string;
  notes?: string;
  totalAmountCents?: number;
  commissionType?: CommissionType;
  commissionValue?: number;
}

const COMMISSION_FIELDS = ["totalAmountCents", "commissionType", "commissionValue"] as const;

export async function updateBooking(id: number, input: UpdateBookingInput, actor: AuditActor | null) {
  const booking = await getBookingById(id);

  const touchesCommission = COMMISSION_FIELDS.some((field) => input[field] !== undefined);

  const data: Prisma.BookingUpdateInput = {
    girlName: input.girlName,
    notes: input.notes
  };

  let auditSnapshot: { before: unknown; after: unknown } | undefined;

  if (touchesCommission) {
    if (await hasEarningHistory(id)) {
      throw new ConflictError(
        "This booking already has completed legs or wallet transactions; total amount and commission can no longer be changed"
      );
    }

    const totalAmountCents = input.totalAmountCents ?? booking.totalAmountCents;
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

    data.totalAmountCents = totalAmountCents;
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

  const updated = await prisma.booking.update({
    where: { id },
    data,
    include: bookingDetailInclude
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

  return updated;
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
      data: { status: "CANCELLED" }
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
