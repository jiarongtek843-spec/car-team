import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import * as bookingsService from "../bookings/bookings.service.js";
import * as driverJobsService from "../driverJobs/driverJobs.service.js";
import * as walletService from "./wallet.service.js";
import type { AuditActor } from "../../common/audit.js";

/**
 * Driver Wallet Transaction History（standalone feature）：读取既有的
 * walletService.listTransactions（跟 Admin Wallet 用同一支函式，只是多带 driverId 过滤）
 * ——这里只测这个 feature 新增/依赖的部分：Leg 的 Pickup/Destination/完成时间有没有正确
 * 带出来、排序是不是新到旧、分页正不正确。不重复测 Wallet 记账本身的金额计算逻辑
 * （wallet.integration.test.ts 已经覆盖），因为这个 feature 明确要求「不改动既有记账逻辑」。
 */

let systemActor: AuditActor;

beforeAll(async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
  systemActor = { id: admin.id, role: "OWNER" };
});

async function createTestDriver(name: string) {
  return prisma.driver.create({ data: { name } });
}

async function fastForwardToOnBoard(legId: number, driverId: number) {
  await prisma.leg.update({ where: { id: legId }, data: { driverId, status: "PASSENGER_ON_BOARD" } });
}

let driverIds: number[] = [];
let bookingIds: number[] = [];

beforeEach(() => {
  driverIds = [];
  bookingIds = [];
});

afterEach(async () => {
  await prisma.walletTransaction.deleteMany({ where: { driverId: { in: driverIds } } });
  await prisma.revenueSharingSnapshot.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.bookingCharge.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.leg.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
});

describe("Driver Wallet Transaction History（standalone feature）", () => {
  it("完成的 Leg 会自动产生一笔 Wallet Transaction，带出 Booking ID / Pickup / Destination / 完成时间", async () => {
    const driver = await createTestDriver("Wallet History Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking(
      { girlName: "WalletHistoryTest", totalAmountCents: 10000, legs: [{ pickupLocation: "Mall A", dropoffLocation: "Hotel B" }] },
      systemActor
    );
    bookingIds.push(booking.id);
    const [leg] = booking.legs;

    await fastForwardToOnBoard(leg.id, driver.id);
    const completedLeg = await driverJobsService.completeLeg(driver.id, leg.id, systemActor);

    const history = await walletService.listTransactions({ driverId: driver.id, page: 1, pageSize: 20 });

    expect(history.total).toBe(1);
    const [record] = history.data;
    expect(record.bookingId).toBe(booking.id);
    expect(record.leg?.pickupLocation).toBe("Mall A");
    expect(record.leg?.dropoffLocation).toBe("Hotel B");
    expect(record.leg?.completedAt).not.toBeNull();
    expect(new Date(record.leg!.completedAt!).getTime()).toBe(new Date(completedLeg.completedAt!).getTime());
    expect(record.amountCents).toBeGreaterThan(0);
    expect(record.status).toBe("PENDING");
  });

  it("按 createdAt 新到旧排序（最新的完成在最前面）", async () => {
    const driver = await createTestDriver("Wallet History Order Driver");
    driverIds.push(driver.id);

    const bookingA = await bookingsService.createBooking(
      { girlName: "WalletHistoryOrderA", totalAmountCents: 5000, legs: [{ pickupLocation: "A1", dropoffLocation: "A2" }] },
      systemActor
    );
    bookingIds.push(bookingA.id);
    await fastForwardToOnBoard(bookingA.legs[0].id, driver.id);
    await driverJobsService.completeLeg(driver.id, bookingA.legs[0].id, systemActor);

    const bookingB = await bookingsService.createBooking(
      { girlName: "WalletHistoryOrderB", totalAmountCents: 5000, legs: [{ pickupLocation: "B1", dropoffLocation: "B2" }] },
      systemActor
    );
    bookingIds.push(bookingB.id);
    await fastForwardToOnBoard(bookingB.legs[0].id, driver.id);
    await driverJobsService.completeLeg(driver.id, bookingB.legs[0].id, systemActor);

    const history = await walletService.listTransactions({ driverId: driver.id, page: 1, pageSize: 20 });

    expect(history.data.map((r) => r.bookingId)).toEqual([bookingB.id, bookingA.id]);
  });

  it("支持分页：pageSize=1 时每页只回一笔，total 反映全部笔数", async () => {
    const driver = await createTestDriver("Wallet History Page Driver");
    driverIds.push(driver.id);

    for (let i = 0; i < 3; i += 1) {
      const booking = await bookingsService.createBooking(
        { girlName: `WalletHistoryPage${i}`, totalAmountCents: 3000, legs: [{ pickupLocation: `P${i}`, dropoffLocation: `D${i}` }] },
        systemActor
      );
      bookingIds.push(booking.id);
      await fastForwardToOnBoard(booking.legs[0].id, driver.id);
      await driverJobsService.completeLeg(driver.id, booking.legs[0].id, systemActor);
    }

    const page1 = await walletService.listTransactions({ driverId: driver.id, page: 1, pageSize: 1 });
    const page2 = await walletService.listTransactions({ driverId: driver.id, page: 2, pageSize: 1 });

    expect(page1.total).toBe(3);
    expect(page1.data).toHaveLength(1);
    expect(page2.data).toHaveLength(1);
    expect(page1.data[0]?.id).not.toBe(page2.data[0]?.id);
  });

  it("只看得到自己的纪录，不会混到其他 Driver 的 Wallet Transaction", async () => {
    const driverA = await createTestDriver("Wallet History Scope Driver A");
    const driverB = await createTestDriver("Wallet History Scope Driver B");
    driverIds.push(driverA.id, driverB.id);

    const booking = await bookingsService.createBooking(
      { girlName: "WalletHistoryScope", totalAmountCents: 4000, legs: [{ pickupLocation: "X", dropoffLocation: "Y" }] },
      systemActor
    );
    bookingIds.push(booking.id);
    await fastForwardToOnBoard(booking.legs[0].id, driverA.id);
    await driverJobsService.completeLeg(driverA.id, booking.legs[0].id, systemActor);

    const historyA = await walletService.listTransactions({ driverId: driverA.id, page: 1, pageSize: 20 });
    const historyB = await walletService.listTransactions({ driverId: driverB.id, page: 1, pageSize: 20 });

    expect(historyA.total).toBe(1);
    expect(historyB.total).toBe(0);
  });
});
