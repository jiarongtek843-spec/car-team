import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import * as bookingsService from "./bookings.service.js";
import * as legsService from "./legs.service.js";
import { ConflictError, NotFoundError, ValidationError } from "../../common/errors.js";
import type { AuditActor } from "../../common/audit.js";

/**
 * UAT 稳定化阶段：legs.service.ts 之前完全没有专属测试文件，assignDriver/cancelLeg/
 * deleteLeg/addLeg 的状态机跟 Validation 都只靠其他模块的测试间接覆盖到一部分。这个文件
 * 专门补齐这些函式本身的正向 + 拒绝案例。
 */

let systemActor: AuditActor;

beforeAll(async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
  systemActor = { id: admin.id, role: "OWNER" };
});

async function createTestDriver(name: string, status: "ACTIVE" | "INACTIVE" = "ACTIVE") {
  return prisma.driver.create({ data: { name, status } });
}

let driverIds: number[] = [];
let bookingIds: number[] = [];

beforeEach(() => {
  driverIds = [];
  bookingIds = [];
});

afterEach(async () => {
  await prisma.walletTransaction.deleteMany({ where: { driverId: { in: driverIds } } });
  await prisma.bookingCharge.deleteMany({ where: { bookingId: { in: bookingIds }, adjustmentType: { not: "NONE" } } });
  await prisma.bookingCharge.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.leg.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
});

describe("Bug Fix：Booking/Leg 建立时验证 driverId 存在且 ACTIVE", () => {
  it("createBooking 传一个不存在的 driverId 会被明确拒绝（不是 Prisma FK 500）", async () => {
    await expect(
      bookingsService.createBooking(
        {
          girlName: "NoSuchDriverBooking",
          totalAmountCents: 6000,
          legs: [{ pickupLocation: "A", dropoffLocation: "B", driverId: 999999999 }]
        },
        systemActor
      )
    ).rejects.toThrow(NotFoundError);
  });

  it("createBooking 传一个 INACTIVE 的 driverId 会被拒绝", async () => {
    const driver = await createTestDriver("Inactive At Create", "INACTIVE");
    driverIds.push(driver.id);

    await expect(
      bookingsService.createBooking(
        {
          girlName: "InactiveDriverBooking",
          totalAmountCents: 6000,
          legs: [{ pickupLocation: "A", dropoffLocation: "B", driverId: driver.id }]
        },
        systemActor
      )
    ).rejects.toThrow(ConflictError);
  });

  it("createBooking 传一个 ACTIVE 的 driverId 正常建立", async () => {
    const driver = await createTestDriver("Active At Create");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking(
      {
        girlName: "ActiveDriverBooking",
        totalAmountCents: 6000,
        legs: [{ pickupLocation: "A", dropoffLocation: "B", driverId: driver.id }]
      },
      systemActor
    );
    bookingIds.push(booking.id);

    expect(booking.legs[0].driverId).toBe(driver.id);
  });

  it("addLeg 传一个不存在的 driverId 会被明确拒绝", async () => {
    const booking = await bookingsService.createBooking({ girlName: "AddLegNoSuchDriver", totalAmountCents: 6000 }, systemActor);
    bookingIds.push(booking.id);

    await expect(legsService.addLeg(booking.id, { pickupLocation: "A", dropoffLocation: "B", driverId: 999999999 })).rejects.toThrow(
      NotFoundError
    );
  });

  it("addLeg 传一个 INACTIVE 的 driverId 会被拒绝", async () => {
    const driver = await createTestDriver("Inactive At AddLeg", "INACTIVE");
    driverIds.push(driver.id);
    const booking = await bookingsService.createBooking({ girlName: "AddLegInactiveDriver", totalAmountCents: 6000 }, systemActor);
    bookingIds.push(booking.id);

    await expect(legsService.addLeg(booking.id, { pickupLocation: "A", dropoffLocation: "B", driverId: driver.id })).rejects.toThrow(
      ConflictError
    );
  });
});

describe("assignDriver", () => {
  it("正常把一个 ASSIGNABLE 状态的 Leg 指派给 ACTIVE Driver", async () => {
    const driver = await createTestDriver("Assign Target");
    driverIds.push(driver.id);
    const booking = await bookingsService.createBooking(
      { girlName: "AssignDriverHappy", totalAmountCents: 6000, legs: [{ pickupLocation: "A", dropoffLocation: "B" }] },
      systemActor
    );
    bookingIds.push(booking.id);
    const [leg] = booking.legs;

    await legsService.assignDriver(booking.id, leg.id, driver.id);
    const updatedLeg = await prisma.leg.findUniqueOrThrow({ where: { id: leg.id } });
    expect(updatedLeg.driverId).toBe(driver.id);
    expect(updatedLeg.status).toBe("ASSIGNED");
  });

  it("指派一个不存在的 Driver 会被拒绝", async () => {
    const booking = await bookingsService.createBooking(
      { girlName: "AssignDriverNoSuchDriver", totalAmountCents: 6000, legs: [{ pickupLocation: "A", dropoffLocation: "B" }] },
      systemActor
    );
    bookingIds.push(booking.id);
    const [leg] = booking.legs;

    await expect(legsService.assignDriver(booking.id, leg.id, 999999999)).rejects.toThrow(NotFoundError);
  });

  it("指派一个 INACTIVE Driver 会被拒绝", async () => {
    const driver = await createTestDriver("Inactive Assign Target", "INACTIVE");
    driverIds.push(driver.id);
    const booking = await bookingsService.createBooking(
      { girlName: "AssignDriverInactive", totalAmountCents: 6000, legs: [{ pickupLocation: "A", dropoffLocation: "B" }] },
      systemActor
    );
    bookingIds.push(booking.id);
    const [leg] = booking.legs;

    await expect(legsService.assignDriver(booking.id, leg.id, driver.id)).rejects.toThrow(ConflictError);
  });
});

describe("cancelLeg / deleteLeg", () => {
  it("cancelLeg 把一个 PENDING Leg 标成 CANCELLED", async () => {
    const booking = await bookingsService.createBooking(
      { girlName: "CancelLegHappy", totalAmountCents: 6000, legs: [{ pickupLocation: "A", dropoffLocation: "B" }] },
      systemActor
    );
    bookingIds.push(booking.id);
    const [leg] = booking.legs;

    await legsService.cancelLeg(booking.id, leg.id);
    const updatedLeg = await prisma.leg.findUniqueOrThrow({ where: { id: leg.id } });
    expect(updatedLeg.status).toBe("CANCELLED");
  });

  it("deleteLeg 只能删除 PENDING 的 Leg，其他状态要拒绝", async () => {
    const driver = await createTestDriver("Delete Leg Guard");
    driverIds.push(driver.id);
    const booking = await bookingsService.createBooking(
      { girlName: "DeleteLegGuard", totalAmountCents: 6000, legs: [{ pickupLocation: "A", dropoffLocation: "B" }] },
      systemActor
    );
    bookingIds.push(booking.id);
    const [leg] = booking.legs;

    await legsService.assignDriver(booking.id, leg.id, driver.id);
    await expect(legsService.deleteLeg(booking.id, leg.id)).rejects.toThrow(ConflictError);
  });

  it("deleteLeg 成功删除一个 PENDING Leg", async () => {
    const booking = await bookingsService.createBooking(
      { girlName: "DeleteLegHappy", totalAmountCents: 6000, legs: [{ pickupLocation: "A", dropoffLocation: "B" }] },
      systemActor
    );
    bookingIds.push(booking.id);
    const [leg] = booking.legs;

    await legsService.deleteLeg(booking.id, leg.id);
    const found = await prisma.leg.findUnique({ where: { id: leg.id } });
    expect(found).toBeNull();
  });
});

describe("并发安全（UAT 稳定化）：addLeg 的分配总额检查上锁", () => {
  it("两个几乎同时的 addLeg，各自单独看都没超额，但加总会超过 Driver Pool -> 只有一个成功", async () => {
    // driverPoolAmountCents = totalAmountCents（0% commission），两笔各 6000 分配加总 12000 > 10000 的 Pool。
    // 本地 Postgres 延迟极低，两个呼叫实际上大多会自然依序执行完成，这个测试主要防止
    // Validation 本身被误删；真正证明 Row Lock 会挡住重叠读取的是下面那个测试。
    const booking = await bookingsService.createBooking(
      { girlName: "ConcurrentAllocation", totalAmountCents: 10000, commissionType: "PERCENTAGE", commissionValue: 0 },
      systemActor
    );
    bookingIds.push(booking.id);

    const results = await Promise.allSettled([
      legsService.addLeg(booking.id, { pickupLocation: "A", dropoffLocation: "B", earningAllocationCents: 6000 }),
      legsService.addLeg(booking.id, { pickupLocation: "C", dropoffLocation: "D", earningAllocationCents: 6000 })
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ValidationError);

    const legs = await prisma.leg.findMany({ where: { bookingId: booking.id } });
    const totalAllocated = legs.reduce((sum, leg) => sum + (leg.earningAllocationCents ?? 0), 0);
    expect(totalAllocated).toBe(6000);
  });

  it("assertAllocationFits 真的会挡住第二个交易，让它读到锁定后的最新总额，而不是锁之前的旧总额", async () => {
    // 直接呼叫production 用的 assertAllocationFits（而不是在测试里另外手刻一段 FOR UPDATE），
    // 才能证明「这个修复」本身有效，不是在证明 Postgres 锁的一般行为。交易 A 呼叫真正的
    // assertAllocationFits + 建立 Leg 之后，刻意 pg_sleep 一段时间才 commit，把锁的持有时间
    // 拉长到足以让交易 B 确实撞上去——如果 assertAllocationFits 没有上锁，B 会在 A commit
    // 之前就读到「分配前」的总额（0），跟 A 各自独立通过检查，看不出真正的超额。
    const booking = await bookingsService.createBooking(
      { girlName: "RowLockProof", totalAmountCents: 10000, commissionType: "PERCENTAGE", commissionValue: 0 },
      systemActor
    );
    bookingIds.push(booking.id);

    const txA = prisma.$transaction(async (tx) => {
      await legsService.assertAllocationFits(tx, booking.id, 6000);
      await tx.leg.create({
        data: { bookingId: booking.id, sequence: 1, pickupLocation: "A", dropoffLocation: "B", earningAllocationCents: 6000 }
      });
      await tx.$executeRaw`SELECT pg_sleep(0.3)`;
    });

    // 给 A 一点头彩，确保它先拿到锁。
    await new Promise((resolve) => setTimeout(resolve, 50));

    const txB = prisma.$transaction(async (tx) => {
      // A 已经用掉 6000，B 再申请 6000 会让总额变 12000，超过 10000 的 Pool——
      // 前提是 B 真的等到 A commit 之后才读総额，而不是读到锁之前的 0。
      await legsService.assertAllocationFits(tx, booking.id, 6000);
    });

    const results = await Promise.allSettled([txA, txB]);

    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    if (results[1].status === "rejected") {
      expect(results[1].reason).toBeInstanceOf(ValidationError);
    }
  });
});
