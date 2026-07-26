import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import * as bookingsService from "../bookings/bookings.service.js";
import * as legsService from "../bookings/legs.service.js";
import * as driverJobsService from "./driverJobs.service.js";
import { ConflictError, NotFoundError } from "../../common/errors.js";
import type { AuditActor } from "../../common/audit.js";

/**
 * UAT 稳定化阶段：driverJobs.service.ts 的 acceptLeg/rejectLeg/markDriverArriving/
 * markPassengerOnBoard/completeLeg 之前完全没有专属测试，既有测试都靠直接改 DB
 * （fastForwardToOnBoard）跳过这些函式本身。这里补齐正向流程 + 状态机拒绝案例，
 * 也涵盖 Driver 被停用（INACTIVE）之后不能再推进状态机的新 Bug Fix。
 */

let systemActor: AuditActor;

beforeAll(async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
  systemActor = { id: admin.id, role: "OWNER" };
});

let driverIds: number[] = [];
let bookingIds: number[] = [];

afterEach(async () => {
  await prisma.walletTransaction.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.revenueSharingSnapshot.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.bookingCharge.deleteMany({ where: { bookingId: { in: bookingIds }, adjustmentType: { not: "NONE" } } });
  await prisma.bookingCharge.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.leg.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
  driverIds = [];
  bookingIds = [];
});

async function createAssignedLeg(girlName: string) {
  const driver = await prisma.driver.create({ data: { name: `${girlName} Driver` } });
  driverIds.push(driver.id);

  const booking = await bookingsService.createBooking(
    { girlName, financialVersion: "V1", totalAmountCents: 6000, legs: [{ pickupLocation: "A", dropoffLocation: "B" }] },
    systemActor
  );
  bookingIds.push(booking.id);
  const [leg] = booking.legs;

  await legsService.assignDriver(booking.id, leg.id, driver.id);
  return { driver, legId: leg.id };
}

describe("acceptLeg", () => {
  it("正常把 ASSIGNED 的 Leg 变成 ACCEPTED", async () => {
    const { driver, legId } = await createAssignedLeg("AcceptLegHappy");
    await driverJobsService.acceptLeg(driver.id, legId);

    const leg = await prisma.leg.findUniqueOrThrow({ where: { id: legId } });
    expect(leg.status).toBe("ACCEPTED");
    expect(leg.acceptedAt).not.toBeNull();
  });

  it("Leg 不是 ASSIGNED 状态时 acceptLeg 会被拒绝", async () => {
    const { driver, legId } = await createAssignedLeg("AcceptLegWrongState");
    await driverJobsService.acceptLeg(driver.id, legId);

    await expect(driverJobsService.acceptLeg(driver.id, legId)).rejects.toThrow(ConflictError);
  });

  it("Bug Fix（UAT 稳定化）：Driver 被停用（INACTIVE）之后不能再 acceptLeg", async () => {
    const { driver, legId } = await createAssignedLeg("AcceptLegInactive");
    await prisma.driver.update({ where: { id: driver.id }, data: { status: "INACTIVE" } });

    await expect(driverJobsService.acceptLeg(driver.id, legId)).rejects.toThrow(ConflictError);

    const leg = await prisma.leg.findUniqueOrThrow({ where: { id: legId } });
    expect(leg.status).toBe("ASSIGNED");
  });

  it("不存在的 Driver acceptLeg 会被拒绝", async () => {
    const { legId } = await createAssignedLeg("AcceptLegNoSuchDriver");
    await expect(driverJobsService.acceptLeg(999999999, legId)).rejects.toThrow(NotFoundError);
  });
});

describe("rejectLeg", () => {
  it("正常把 ASSIGNED 的 Leg 变成 REJECTED 并记录原因", async () => {
    const { driver, legId } = await createAssignedLeg("RejectLegHappy");
    await driverJobsService.rejectLeg(driver.id, legId, "Passenger cancelled");

    const leg = await prisma.leg.findUniqueOrThrow({ where: { id: legId } });
    expect(leg.status).toBe("REJECTED");
    expect(leg.rejectionReason).toBe("Passenger cancelled");
  });

  it("Bug Fix（UAT 稳定化）：Driver 被停用之后不能再 rejectLeg", async () => {
    const { driver, legId } = await createAssignedLeg("RejectLegInactive");
    await prisma.driver.update({ where: { id: driver.id }, data: { status: "INACTIVE" } });

    await expect(driverJobsService.rejectLeg(driver.id, legId, "reason")).rejects.toThrow(ConflictError);
  });
});

describe("markDriverArriving / markPassengerOnBoard", () => {
  it("正常依序推进 ACCEPTED -> DRIVER_ARRIVING -> PASSENGER_ON_BOARD", async () => {
    const { driver, legId } = await createAssignedLeg("ArrivingOnBoardHappy");
    await driverJobsService.acceptLeg(driver.id, legId);
    await driverJobsService.markDriverArriving(driver.id, legId);

    let leg = await prisma.leg.findUniqueOrThrow({ where: { id: legId } });
    expect(leg.status).toBe("DRIVER_ARRIVING");

    await driverJobsService.markPassengerOnBoard(driver.id, legId);
    leg = await prisma.leg.findUniqueOrThrow({ where: { id: legId } });
    expect(leg.status).toBe("PASSENGER_ON_BOARD");
  });

  it("跳过 ACCEPTED 直接 markDriverArriving 会被状态机拒绝", async () => {
    const { driver, legId } = await createAssignedLeg("SkipAcceptedGuard");
    await expect(driverJobsService.markDriverArriving(driver.id, legId)).rejects.toThrow(ConflictError);
  });

  it("Bug Fix（UAT 稳定化）：Driver 被停用之后不能再 markDriverArriving/markPassengerOnBoard", async () => {
    const { driver, legId } = await createAssignedLeg("ArrivingInactive");
    await driverJobsService.acceptLeg(driver.id, legId);
    await prisma.driver.update({ where: { id: driver.id }, data: { status: "INACTIVE" } });

    await expect(driverJobsService.markDriverArriving(driver.id, legId)).rejects.toThrow(ConflictError);
  });
});

describe("completeLeg", () => {
  it("正常把 PASSENGER_ON_BOARD 的 Leg 变成 COMPLETED 并产生 V1 收入记录", async () => {
    const { driver, legId } = await createAssignedLeg("CompleteLegHappy");
    await driverJobsService.acceptLeg(driver.id, legId);
    await driverJobsService.markDriverArriving(driver.id, legId);
    await driverJobsService.markPassengerOnBoard(driver.id, legId);
    await driverJobsService.completeLeg(driver.id, legId, systemActor);

    const leg = await prisma.leg.findUniqueOrThrow({ where: { id: legId } });
    expect(leg.status).toBe("COMPLETED");

    const transaction = await prisma.walletTransaction.findFirstOrThrow({ where: { legId } });
    expect(transaction.transactionType).toBe("LEG_EARNING");
  });

  it("跳过前置状态直接 completeLeg 会被状态机拒绝", async () => {
    const { driver, legId } = await createAssignedLeg("CompleteLegSkipGuard");
    await expect(driverJobsService.completeLeg(driver.id, legId, systemActor)).rejects.toThrow(ConflictError);
  });

  it("刻意不挡：Driver 被停用之后仍然可以 completeLeg（已经在跑的行程走到完成不该被卡住）", async () => {
    const { driver, legId } = await createAssignedLeg("CompleteLegInactiveAllowed");
    await driverJobsService.acceptLeg(driver.id, legId);
    await driverJobsService.markDriverArriving(driver.id, legId);
    await driverJobsService.markPassengerOnBoard(driver.id, legId);
    await prisma.driver.update({ where: { id: driver.id }, data: { status: "INACTIVE" } });

    await driverJobsService.completeLeg(driver.id, legId, systemActor);

    const leg = await prisma.leg.findUniqueOrThrow({ where: { id: legId } });
    expect(leg.status).toBe("COMPLETED");
  });
});
