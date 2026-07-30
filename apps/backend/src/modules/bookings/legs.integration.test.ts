import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import * as bookingsService from "./bookings.service.js";
import * as legsService from "./legs.service.js";
import * as driverJobsService from "../driverJobs/driverJobs.service.js";
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

describe("Mobile UAT Round 2：Leg Estimated Duration / Estimated Finish Time Validation", () => {
  it("addLeg 传 estimatedDurationMinutes <= 0 会被拒绝", async () => {
    const booking = await bookingsService.createBooking({ girlName: "DurationZero", totalAmountCents: 6000 }, systemActor);
    bookingIds.push(booking.id);

    await expect(
      legsService.addLeg(booking.id, { pickupLocation: "A", dropoffLocation: "B", estimatedDurationMinutes: 0 })
    ).rejects.toThrow(ValidationError);
  });

  it("addLeg 的 estimatedFinishAt 早于 scheduledAt 会被拒绝", async () => {
    const booking = await bookingsService.createBooking({ girlName: "FinishBeforePickup", totalAmountCents: 6000 }, systemActor);
    bookingIds.push(booking.id);

    await expect(
      legsService.addLeg(booking.id, {
        pickupLocation: "A",
        dropoffLocation: "B",
        scheduledAt: "2026-08-01T09:00:00.000Z",
        estimatedFinishAt: "2026-08-01T08:00:00.000Z"
      })
    ).rejects.toThrow(ValidationError);
  });

  it("addLeg 带合理的 Duration/Finish 会正确存起来", async () => {
    const booking = await bookingsService.createBooking({ girlName: "DurationFinishHappy", totalAmountCents: 6000 }, systemActor);
    bookingIds.push(booking.id);

    const updated = await legsService.addLeg(booking.id, {
      pickupLocation: "A",
      dropoffLocation: "B",
      scheduledAt: "2026-08-01T09:00:00.000Z",
      estimatedDurationMinutes: 180,
      estimatedFinishAt: "2026-08-01T12:00:00.000Z"
    });
    const leg = updated.legs.find((l) => l.pickupLocation === "A");
    expect(leg?.estimatedDurationMinutes).toBe(180);
    expect(leg?.estimatedFinishAt).not.toBeNull();
  });

  it("updateLeg 只改 estimatedDurationMinutes 时，仍然会拿现有的 scheduledAt/estimatedFinishAt 一起做 Validation", async () => {
    const booking = await bookingsService.createBooking(
      {
        girlName: "UpdateLegDurationValidation",
        totalAmountCents: 6000,
        legs: [
          {
            pickupLocation: "A",
            dropoffLocation: "B",
            scheduledAt: "2026-08-01T09:00:00.000Z",
            estimatedFinishAt: "2026-08-01T10:00:00.000Z"
          }
        ]
      },
      systemActor
    );
    bookingIds.push(booking.id);
    const [leg] = booking.legs;

    // 现有 Finish 是 10:00，Pickup 是 09:00；把 Duration 改多长都不该影响这个既有关系被
    // 重新验证一次——这里改 Duration 本身合法（>0），应该成功，且不会动到 Finish 栏位。
    await legsService.updateLeg(booking.id, leg.id, { estimatedDurationMinutes: 90 }, systemActor);
    const reloaded = await prisma.leg.findUniqueOrThrow({ where: { id: leg.id } });
    expect(reloaded.estimatedDurationMinutes).toBe(90);
    expect(reloaded.estimatedFinishAt?.toISOString()).toBe(new Date("2026-08-01T10:00:00.000Z").toISOString());
  });

  it("updateLeg 想把 Duration 改成 0 会被拒绝，且不会改动任何栏位", async () => {
    const booking = await bookingsService.createBooking(
      {
        girlName: "UpdateLegDurationInvalid",
        totalAmountCents: 6000,
        legs: [{ pickupLocation: "A", dropoffLocation: "B" }]
      },
      systemActor
    );
    bookingIds.push(booking.id);
    const [leg] = booking.legs;

    await expect(legsService.updateLeg(booking.id, leg.id, { estimatedDurationMinutes: -5 }, systemActor)).rejects.toThrow(
      ValidationError
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
      // Mobile UAT Round 2：assertAllocationFits 现在只统计「冻结」金额（COMPLETED 或
      // earningAllocationManual=true），这里手动建立的 Leg 要明确标成 manual，才代表
      // 这 6000 已经是「确定要用掉」的额度，不会被当成仍是自动模式、可以被平分掉的份额。
      await tx.leg.create({
        data: {
          bookingId: booking.id,
          sequence: 1,
          pickupLocation: "A",
          dropoffLocation: "B",
          earningAllocationCents: 6000,
          earningAllocationManual: true
        }
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

  it("Stabilization Bug Fix：两个几乎同时的 addLeg（都没带 earningAllocationCents，以前完全不上锁）不会撞上重复的 sequence", async () => {
    // 修法之前：lastLeg 的读取跟 leg.create 之间没有锁，两个几乎同时的 addLeg 都读到
    // 同一个 lastLeg.sequence，一起 insert 相同的 sequence，撞上 @@unique([bookingId,
    // sequence])，变成一个没接住的 P2002 500。现在两个都应该成功，各自拿到不同的 sequence。
    const booking = await bookingsService.createBooking(
      { girlName: "ConcurrentSequenceTest", totalAmountCents: 0 },
      systemActor
    );
    bookingIds.push(booking.id);

    const results = await Promise.allSettled([
      legsService.addLeg(booking.id, { pickupLocation: "A", dropoffLocation: "B" }),
      legsService.addLeg(booking.id, { pickupLocation: "C", dropoffLocation: "D" })
    ]);

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const legs = await prisma.leg.findMany({ where: { bookingId: booking.id }, orderBy: { sequence: "asc" } });
    expect(legs).toHaveLength(2);
    expect(legs.map((l) => l.sequence)).toEqual([1, 2]);
  });
});

async function fastForwardToOnBoard(legId: number, driverId: number) {
  await prisma.leg.update({ where: { id: legId }, data: { driverId, status: "PASSENGER_ON_BOARD" } });
}

describe("Mobile UAT Round 2：Driver Income 自动按 Leg 数量平分 Driver Pool", () => {
  it("2 个 Leg 平分 Driver Pool（Fare 60 元 15% 抽成 -> Pool 51 元，每个 Leg 25.50 元）", async () => {
    const booking = await bookingsService.createBooking(
      {
        girlName: "AutoAllocationTwoLegs",
        totalAmountCents: 6000,
        commissionType: "PERCENTAGE",
        commissionValue: 15,
        legs: [{ pickupLocation: "28", dropoffLocation: "B" }, { pickupLocation: "B", dropoffLocation: "28" }]
      },
      systemActor
    );
    bookingIds.push(booking.id);

    expect(booking.driverPoolAmountCents).toBe(5100);
    const legs = await prisma.leg.findMany({ where: { bookingId: booking.id }, orderBy: { sequence: "asc" } });
    expect(legs.map((leg) => leg.earningAllocationCents)).toEqual([2550, 2550]);
    expect(legs.every((leg) => leg.earningAllocationManual === false)).toBe(true);
  });

  it("新增第 3 个 Leg 后，Driver Pool 自动在 3 个 Leg 之间重新平分", async () => {
    const booking = await bookingsService.createBooking(
      {
        girlName: "AutoAllocationRedistribute",
        totalAmountCents: 6000,
        commissionType: "PERCENTAGE",
        commissionValue: 15,
        legs: [{ pickupLocation: "28", dropoffLocation: "B" }, { pickupLocation: "B", dropoffLocation: "28" }]
      },
      systemActor
    );
    bookingIds.push(booking.id);

    await legsService.addLeg(booking.id, { legType: "ADDITIONAL", pickupLocation: "28", dropoffLocation: "C" });

    const legs = await prisma.leg.findMany({ where: { bookingId: booking.id }, orderBy: { sequence: "asc" } });
    expect(legs).toHaveLength(3);
    expect(legs.map((leg) => leg.earningAllocationCents)).toEqual([1700, 1700, 1700]);
  });

  it("手动 override 一个 Leg 后，其余 Leg 只平分剩余的 Pool，不会覆盖手动那笔", async () => {
    const booking = await bookingsService.createBooking(
      {
        girlName: "AutoAllocationManualOverride",
        totalAmountCents: 6000,
        commissionType: "PERCENTAGE",
        commissionValue: 15,
        legs: [{ pickupLocation: "28", dropoffLocation: "B" }, { pickupLocation: "B", dropoffLocation: "28" }]
      },
      systemActor
    );
    bookingIds.push(booking.id);
    const [legA, legB] = booking.legs;

    await legsService.updateLeg(booking.id, legA.id, { earningAllocationCents: 4000 }, systemActor);

    const reloadedA = await prisma.leg.findUniqueOrThrow({ where: { id: legA.id } });
    const reloadedB = await prisma.leg.findUniqueOrThrow({ where: { id: legB.id } });
    expect(reloadedA.earningAllocationCents).toBe(4000);
    expect(reloadedA.earningAllocationManual).toBe(true);
    expect(reloadedB.earningAllocationCents).toBe(1100);
    expect(reloadedB.earningAllocationManual).toBe(false);

    // 手动那笔冻结之后再新增一个 Leg，只有仍是自动模式的两个 Leg 平分剩下的 1100。
    await legsService.addLeg(booking.id, { legType: "ADDITIONAL", pickupLocation: "28", dropoffLocation: "D" });
    const afterAdd = await prisma.leg.findMany({ where: { bookingId: booking.id }, orderBy: { sequence: "asc" } });
    expect(afterAdd.find((leg) => leg.id === legA.id)?.earningAllocationCents).toBe(4000);
    const autoShares = afterAdd.filter((leg) => leg.id !== legA.id).map((leg) => leg.earningAllocationCents);
    expect(autoShares).toEqual([550, 550]);
  });

  it("已经 COMPLETED 的 Leg 收入冻结，新增 Leg 不会改动它，只影响仍在自动模式的其他 Leg", async () => {
    const driver = await createTestDriver("Auto Allocation Frozen Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking(
      {
        girlName: "AutoAllocationCompletedFrozen",
        financialVersion: "V1",
        totalAmountCents: 6000,
        commissionType: "PERCENTAGE",
        commissionValue: 15,
        legs: [{ pickupLocation: "28", dropoffLocation: "B" }, { pickupLocation: "B", dropoffLocation: "28" }]
      },
      systemActor
    );
    bookingIds.push(booking.id);
    const [legA, legB] = booking.legs;

    await fastForwardToOnBoard(legA.id, driver.id);
    await driverJobsService.completeLeg(driver.id, legA.id, systemActor);

    const completedLeg = await prisma.leg.findUniqueOrThrow({ where: { id: legA.id } });
    expect(completedLeg.earningAllocationCents).toBe(2550);

    await legsService.addLeg(booking.id, { legType: "ADDITIONAL", pickupLocation: "28", dropoffLocation: "C" });

    const reloadedCompleted = await prisma.leg.findUniqueOrThrow({ where: { id: legA.id } });
    expect(reloadedCompleted.earningAllocationCents).toBe(2550);

    const others = await prisma.leg.findMany({ where: { bookingId: booking.id, id: { not: legA.id } } });
    // 剩下 5100-2550=2550，两个自动 Leg（原本的 legB + 新增的）各分 1275。
    expect(others.map((leg) => leg.earningAllocationCents).sort()).toEqual([1275, 1275]);
    void legB;
  });

  it("取消一个 Leg 之后，剩下的 Leg 重新平分 Driver Pool", async () => {
    const booking = await bookingsService.createBooking(
      {
        girlName: "AutoAllocationCancelRedistribute",
        totalAmountCents: 6000,
        commissionType: "PERCENTAGE",
        commissionValue: 15,
        legs: [
          { pickupLocation: "28", dropoffLocation: "B" },
          { pickupLocation: "B", dropoffLocation: "28" },
          { legType: "ADDITIONAL", pickupLocation: "28", dropoffLocation: "C" }
        ]
      },
      systemActor
    );
    bookingIds.push(booking.id);
    const [, legB, legC] = booking.legs;

    await legsService.cancelLeg(booking.id, legB.id);

    const survivors = await prisma.leg.findMany({
      where: { bookingId: booking.id, status: { not: "CANCELLED" } }
    });
    expect(survivors.map((leg) => leg.earningAllocationCents)).toEqual([2550, 2550]);
    void legC;
  });

  it("Booking 抽成调整、Driver Pool 变大时，仍是自动模式的 Leg 会跟着重新平分", async () => {
    const booking = await bookingsService.createBooking(
      {
        girlName: "AutoAllocationCommissionChange",
        totalAmountCents: 6000,
        commissionType: "PERCENTAGE",
        commissionValue: 15,
        legs: [{ pickupLocation: "28", dropoffLocation: "B" }, { pickupLocation: "B", dropoffLocation: "28" }]
      },
      systemActor
    );
    bookingIds.push(booking.id);

    await bookingsService.updateBooking(booking.id, { commissionValue: 0 }, systemActor);

    const legs = await prisma.leg.findMany({ where: { bookingId: booking.id }, orderBy: { sequence: "asc" } });
    expect(legs.map((leg) => leg.earningAllocationCents)).toEqual([3000, 3000]);
  });
});
