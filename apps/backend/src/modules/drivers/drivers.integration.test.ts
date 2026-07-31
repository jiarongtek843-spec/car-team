import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import * as driversService from "./drivers.service.js";
import { verifyPassword } from "../../common/password.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../common/errors.js";

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "DevPass123!";

/**
 * UAT 稳定化阶段：drivers.service.ts 之前完全没有专属测试文件。这个文件补齐
 * createDriver/resetDriverPassword/setDriverStatus 本身的正向 + 拒绝案例。
 */

let driverIds: number[] = [];

afterEach(async () => {
  const drivers = await prisma.driver.findMany({ where: { id: { in: driverIds } }, select: { userId: true } });
  const userIds = drivers.map((d) => d.userId).filter((id): id is number => id !== null);
  await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  driverIds = [];
});

describe("createDriver", () => {
  it("username 和 password 都填时建立 Driver 也建立登入帐号", async () => {
    const driver = await driversService.createDriver({
      name: "Login Driver",
      username: `login_driver_${Date.now()}`,
      password: "hunter2hunter"
    });
    driverIds.push(driver.id);

    expect(driver.userId).not.toBeNull();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: driver.userId! } });
    expect(await verifyPassword("hunter2hunter", user.passwordHash)).toBe(true);
  });

  it("username 和 password 都不填时建立 Driver，不建立登入帐号", async () => {
    const driver = await driversService.createDriver({ name: "No Login Driver" });
    driverIds.push(driver.id);

    expect(driver.userId).toBeNull();
  });

  it("Bug Fix（UAT 稳定化）：只填 username 不填 password 会被明确拒绝，不是静默忽略", async () => {
    await expect(
      driversService.createDriver({ name: "Half Filled Driver", username: `half_${Date.now()}` })
    ).rejects.toThrow(ValidationError);

    const found = await prisma.driver.findFirst({ where: { name: "Half Filled Driver" } });
    expect(found).toBeNull();
  });

  it("Bug Fix（UAT 稳定化）：只填 password 不填 username 会被明确拒绝，不是静默忽略", async () => {
    await expect(driversService.createDriver({ name: "Half Filled Driver 2", password: "somepassword" })).rejects.toThrow(
      ValidationError
    );

    const found = await prisma.driver.findFirst({ where: { name: "Half Filled Driver 2" } });
    expect(found).toBeNull();
  });
});

describe("resetDriverPassword", () => {
  it("有登入帐号的 Driver 可以重设密码", async () => {
    const driver = await driversService.createDriver({
      name: "Reset Target",
      username: `reset_target_${Date.now()}`,
      password: "originalPassword1"
    });
    driverIds.push(driver.id);

    await driversService.resetDriverPassword(driver.id, "newPassword1");

    const user = await prisma.user.findUniqueOrThrow({ where: { id: driver.userId! } });
    expect(await verifyPassword("newPassword1", user.passwordHash)).toBe(true);
  });

  it("没有登入帐号的 Driver 重设密码会被拒绝", async () => {
    const driver = await driversService.createDriver({ name: "No Account Driver" });
    driverIds.push(driver.id);

    await expect(driversService.resetDriverPassword(driver.id, "whatever1")).rejects.toThrow(ConflictError);
  });

  it("不存在的 Driver 重设密码会被拒绝", async () => {
    await expect(driversService.resetDriverPassword(999999999, "whatever1")).rejects.toThrow(NotFoundError);
  });
});

describe("setDriverStatus", () => {
  it("正常把 Driver 状态改成 INACTIVE 再改回 ACTIVE", async () => {
    const driver = await driversService.createDriver({ name: "Status Toggle Driver" });
    driverIds.push(driver.id);

    const inactive = await driversService.setDriverStatus(driver.id, "INACTIVE");
    expect(inactive.status).toBe("INACTIVE");

    const active = await driversService.setDriverStatus(driver.id, "ACTIVE");
    expect(active.status).toBe("ACTIVE");
  });

  it("不存在的 Driver 改状态会被拒绝", async () => {
    await expect(driversService.setDriverStatus(999999999, "INACTIVE")).rejects.toThrow(NotFoundError);
  });
});

describe("deleteDriver", () => {
  it("已停用、没有任何业务纪录的 Driver：密码正确就能真的删除，连带清掉登入帐号", async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    const driver = await driversService.createDriver({
      name: "Delete Target",
      username: `delete_target_${Date.now()}`,
      password: "originalPassword1"
    });
    driverIds.push(driver.id);
    await driversService.setDriverStatus(driver.id, "INACTIVE");

    await driversService.deleteDriver(driver.id, admin.id, SEED_PASSWORD);

    expect(await prisma.driver.findUnique({ where: { id: driver.id } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: driver.userId! } })).toBeNull();
  });

  it("目前是 ACTIVE 的 Driver：拒绝删除，一定要先停用", async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    const driver = await driversService.createDriver({ name: "Still Active Driver" });
    driverIds.push(driver.id);

    await expect(driversService.deleteDriver(driver.id, admin.id, SEED_PASSWORD)).rejects.toThrow(ConflictError);
    expect(await prisma.driver.findUnique({ where: { id: driver.id } })).not.toBeNull();
  });

  it("操作者密码错误：拒绝删除，Driver 还在", async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    const driver = await driversService.createDriver({ name: "Wrong Password Target" });
    driverIds.push(driver.id);
    await driversService.setDriverStatus(driver.id, "INACTIVE");

    await expect(driversService.deleteDriver(driver.id, admin.id, "definitely-wrong-password")).rejects.toThrow(
      ForbiddenError
    );
    expect(await prisma.driver.findUnique({ where: { id: driver.id } })).not.toBeNull();
  });

  it("已经有真实业务纪录（例如上传过 GPS 定位）：即使已停用、密码也对，还是拒绝删除", async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    const driver = await driversService.createDriver({ name: "Has History Driver" });
    driverIds.push(driver.id);
    await prisma.driverLocation.create({
      data: { driverId: driver.id, latitude: 3.14, longitude: 101.68, recordedAt: new Date() }
    });
    await driversService.setDriverStatus(driver.id, "INACTIVE");

    await expect(driversService.deleteDriver(driver.id, admin.id, SEED_PASSWORD)).rejects.toThrow(ConflictError);
    expect(await prisma.driver.findUnique({ where: { id: driver.id } })).not.toBeNull();

    // driver_locations 对 driver_id 是 ON DELETE RESTRICT——留着不清掉的话，afterEach
    // 那个通用的 prisma.driver.deleteMany() 也会被同一条约束卡住而丢出真的 DB 错误。
    await prisma.driverLocation.delete({ where: { driverId: driver.id } });
  });

  it("不存在的 Driver：拒绝删除", async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    await expect(driversService.deleteDriver(999999999, admin.id, SEED_PASSWORD)).rejects.toThrow(NotFoundError);
  });
});
