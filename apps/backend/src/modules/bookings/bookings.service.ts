import type { BookingStatus, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { NotFoundError } from "../../common/errors.js";
import { deriveBookingStatus } from "./bookings.status.js";

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
}

interface CreateBookingInput {
  girlName: string;
  carFee?: number;
  notes?: string;
  legs?: CreateLegInput[];
}

export async function createBooking(input: CreateBookingInput) {
  const booking = await prisma.booking.create({
    data: {
      girlName: input.girlName,
      carFee: input.carFee,
      notes: input.notes,
      legs: input.legs
        ? {
            create: input.legs.map((leg, index) => ({
              sequence: index + 1,
              pickupLocation: leg.pickupLocation,
              dropoffLocation: leg.dropoffLocation,
              scheduledAt: leg.scheduledAt ? new Date(leg.scheduledAt) : undefined,
              driverId: leg.driverId,
              notes: leg.notes
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
  carFee?: number;
  notes?: string;
}

export async function updateBooking(id: number, input: UpdateBookingInput) {
  await getBookingById(id);

  return prisma.booking.update({
    where: { id },
    data: input,
    include: bookingDetailInclude
  });
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
