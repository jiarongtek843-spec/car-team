import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import * as bookingsService from "../bookings/bookings.service.js";

/**
 * Module 13（Collection Ledger Schema：Collected By / Receiver）的 Database Integration
 * Test。这次只到 Schema 层——Collection API/Service 完全没有改动（见 docs/modules/collection.md
 * 已知限制），这里直接用 Prisma Client 操作新栏位，验证的是 migration 建出来的约束
 * （CHECK/Index/FK 删除策略/预设值）本身有没有正确生效，不是业务逻辑（业务逻辑测试仍在
 * collection.integration.test.ts，这次刻意不动那个档案，证明现有 API 不用改就能继续运作）。
 */

async function createTestDriver(name: string) {
  return prisma.driver.create({ data: { name } });
}

async function createTestBooking(girlName: string) {
  return bookingsService.createBooking({ girlName, totalAmountCents: 0 });
}

let driverIds: number[] = [];
let bookingIds: number[] = [];

beforeEach(() => {
  driverIds = [];
  bookingIds = [];
});

afterEach(async () => {
  await prisma.collection.deleteMany({ where: { OR: [{ driverId: { in: driverIds } }, { bookingId: { in: bookingIds } }] } });
  await prisma.leg.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
});

describe("collections 新栏位预设值（沿用既有 create 流程，不用改 API/Service）", () => {
  it("不指定 collectedBy/receiverType 时，默认落在 DRIVER/DRIVER（跟既有唯一支持的流程一致）", async () => {
    const driver = await createTestDriver("Schema Default Driver");
    driverIds.push(driver.id);
    const booking = await createTestBooking("SchemaDefault");
    bookingIds.push(booking.id);

    const collection = await prisma.collection.create({
      data: {
        bookingId: booking.id,
        driverId: driver.id,
        purpose: "OTHER",
        amountCents: 1000,
        paymentMethod: "CASH",
        status: "COLLECTED"
      }
    });

    expect(collection.collectedBy).toBe("DRIVER");
    expect(collection.receiverType).toBe("DRIVER");
    expect(collection.receiverId).toBeNull();
    expect(collection.updatedAt).toBeInstanceOf(Date);
  });

  it("updatedAt 会在 update 时自动往前推进", async () => {
    const driver = await createTestDriver("Schema UpdatedAt Driver");
    driverIds.push(driver.id);
    const booking = await createTestBooking("SchemaUpdatedAt");
    bookingIds.push(booking.id);

    const created = await prisma.collection.create({
      data: { bookingId: booking.id, driverId: driver.id, purpose: "OTHER", amountCents: 1000, paymentMethod: "CASH", status: "COLLECTED" }
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const updated = await prisma.collection.update({ where: { id: created.id }, data: { remark: "updated" } });
    expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
  });
});

describe("collections 支持 Collected By = COMPANY（driverId 可以留空）", () => {
  it("可以建立没有 driverId 的 COMPANY 收款记录", async () => {
    const booking = await createTestBooking("CompanyCollected");
    bookingIds.push(booking.id);

    const collection = await prisma.collection.create({
      data: {
        bookingId: booking.id,
        purpose: "OTHER",
        amountCents: 2000,
        paymentMethod: "TRANSFER_TO_COMPANY",
        status: "COLLECTED",
        collectedBy: "COMPANY",
        receiverType: "COMPANY",
        receiverLabel: "Company Account A"
      }
    });

    expect(collection.driverId).toBeNull();
    expect(collection.collectedBy).toBe("COMPANY");
    expect(collection.receiverLabel).toBe("Company Account A");
  });

  it("COMPANY 收款也可以保留 driverId（记录归属于哪个 Driver 的哪趟行程，方便对账）", async () => {
    const driver = await createTestDriver("Company With Driver Ref");
    driverIds.push(driver.id);
    const booking = await createTestBooking("CompanyWithDriverRef");
    bookingIds.push(booking.id);

    const collection = await prisma.collection.create({
      data: {
        bookingId: booking.id,
        driverId: driver.id,
        purpose: "OTHER",
        amountCents: 2000,
        paymentMethod: "TRANSFER_TO_COMPANY",
        status: "COLLECTED",
        collectedBy: "COMPANY",
        receiverType: "COMPANY"
      }
    });

    expect(collection.driverId).toBe(driver.id);
    expect(collection.collectedBy).toBe("COMPANY");
  });
});

describe("CHECK constraint: collected_by = DRIVER 时必须关联具体 Driver（业务规则 2）", () => {
  it("拒绝 collectedBy=DRIVER 但 driverId 是 null 的记录", async () => {
    const booking = await createTestBooking("CheckCollectedByDriver");
    bookingIds.push(booking.id);

    await expect(
      prisma.collection.create({
        data: {
          bookingId: booking.id,
          purpose: "OTHER",
          amountCents: 500,
          paymentMethod: "CASH",
          status: "COLLECTED",
          collectedBy: "DRIVER"
        }
      })
    ).rejects.toThrow();
  });
});

describe("CHECK constraint: receiverType 必须跟 collectedBy 一致", () => {
  it("拒绝 collectedBy=DRIVER 但 receiverType=COMPANY 的组合", async () => {
    const driver = await createTestDriver("Mismatch Receiver Type");
    driverIds.push(driver.id);
    const booking = await createTestBooking("CheckReceiverTypeMismatch");
    bookingIds.push(booking.id);

    await expect(
      prisma.collection.create({
        data: {
          bookingId: booking.id,
          driverId: driver.id,
          purpose: "OTHER",
          amountCents: 500,
          paymentMethod: "CASH",
          status: "COLLECTED",
          collectedBy: "DRIVER",
          receiverType: "COMPANY"
        }
      })
    ).rejects.toThrow();
  });

  it("拒绝 collectedBy=COMPANY 但 receiverType=DRIVER 的组合", async () => {
    const booking = await createTestBooking("CheckReceiverTypeMismatch2");
    bookingIds.push(booking.id);

    await expect(
      prisma.collection.create({
        data: {
          bookingId: booking.id,
          purpose: "OTHER",
          amountCents: 500,
          paymentMethod: "TRANSFER_TO_COMPANY",
          status: "COLLECTED",
          collectedBy: "COMPANY",
          receiverType: "DRIVER"
        }
      })
    ).rejects.toThrow();
  });
});

describe("CHECK constraint: receiverType=DRIVER 时 receiverId 若有填必须等于 driverId", () => {
  it("接受 receiverId 等于 driverId", async () => {
    const driver = await createTestDriver("Receiver Id Match");
    driverIds.push(driver.id);
    const booking = await createTestBooking("CheckReceiverIdMatch");
    bookingIds.push(booking.id);

    const collection = await prisma.collection.create({
      data: {
        bookingId: booking.id,
        driverId: driver.id,
        purpose: "OTHER",
        amountCents: 500,
        paymentMethod: "CASH",
        status: "COLLECTED",
        collectedBy: "DRIVER",
        receiverType: "DRIVER",
        receiverId: driver.id
      }
    });
    expect(collection.receiverId).toBe(driver.id);
  });

  it("接受 receiverId 留空（还没被填过）", async () => {
    const driver = await createTestDriver("Receiver Id Null");
    driverIds.push(driver.id);
    const booking = await createTestBooking("CheckReceiverIdNull");
    bookingIds.push(booking.id);

    const collection = await prisma.collection.create({
      data: {
        bookingId: booking.id,
        driverId: driver.id,
        purpose: "OTHER",
        amountCents: 500,
        paymentMethod: "CASH",
        status: "COLLECTED",
        collectedBy: "DRIVER",
        receiverType: "DRIVER"
      }
    });
    expect(collection.receiverId).toBeNull();
  });

  it("拒绝 receiverId 是别的 Driver（跟 driverId 不一致）", async () => {
    const driver = await createTestDriver("Receiver Id Owner");
    const otherDriver = await createTestDriver("Receiver Id Stranger");
    driverIds.push(driver.id, otherDriver.id);
    const booking = await createTestBooking("CheckReceiverIdMismatch");
    bookingIds.push(booking.id);

    await expect(
      prisma.collection.create({
        data: {
          bookingId: booking.id,
          driverId: driver.id,
          purpose: "OTHER",
          amountCents: 500,
          paymentMethod: "CASH",
          status: "COLLECTED",
          collectedBy: "DRIVER",
          receiverType: "DRIVER",
          receiverId: otherDriver.id
        }
      })
    ).rejects.toThrow();
  });
});

describe("driver_id 外键删除策略：RESTRICT（跟 wallet_transactions/trip_expenses 一致）", () => {
  it("Driver 还有 Collection 记录时不能被物理删除", async () => {
    const driver = await createTestDriver("Restrict Delete Driver");
    driverIds.push(driver.id);
    const booking = await createTestBooking("RestrictDelete");
    bookingIds.push(booking.id);

    await prisma.collection.create({
      data: { bookingId: booking.id, driverId: driver.id, purpose: "OTHER", amountCents: 500, paymentMethod: "CASH", status: "COLLECTED" }
    });

    await expect(prisma.driver.delete({ where: { id: driver.id } })).rejects.toThrow();
  });
});

describe("Index 存在性检查（migration 建的 5 个新 Index，用 pg_indexes 直接查）", () => {
  it("collections 表上有预期的 index", async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'collections'
    `;
    const names = rows.map((r) => r.indexname);
    expect(names).toContain("collections_driver_id_status_collected_at_idx");
    expect(names).toContain("collections_booking_id_idx");
    expect(names).toContain("collections_status_idx");
    expect(names).toContain("collections_collected_by_idx");
    expect(names).toContain("collections_receiver_type_receiver_id_idx");
  });
});
