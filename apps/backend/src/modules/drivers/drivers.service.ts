import type { DriverStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { hashPassword, verifyPassword } from "../../common/password.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../common/errors.js";
import { UNFINISHED_LEG_STATUSES } from "../bookings/bookings.status.js";
import { ROLE_KEYS } from "../../common/permissions.js";

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export async function listDrivers(status?: DriverStatus) {
  const drivers = await prisma.driver.findMany({
    where: status ? { status } : undefined,
    include: {
      user: { select: { username: true } },
      _count: { select: { legs: { where: { status: { in: UNFINISHED_LEG_STATUSES } } } } }
    },
    orderBy: { name: "asc" }
  });

  return drivers.map((driver) => ({
    id: driver.id,
    name: driver.name,
    phone: driver.phone,
    vehiclePlateNumber: driver.vehiclePlateNumber,
    remark: driver.remark,
    status: driver.status,
    username: driver.user?.username ?? null,
    hasActiveLeg: driver._count.legs > 0,
    createdAt: driver.createdAt,
    updatedAt: driver.updatedAt
  }));
}

interface CreateDriverInput {
  name: string;
  phone?: string;
  vehiclePlateNumber?: string;
  remark?: string;
  username?: string;
  password?: string;
}

/**
 * Bug Fix（UAT 稳定化阶段）：username/password 之前只有「两个都填」才会建立登入帐号，
 * 「只填一个」会被静默忽略（既不建帐号也不报错），呼叫端毫无线索。改成「两个都填」建立
 * 帐号、「两个都不填」是合法的纯 Driver 资料（不建帐号），只有「只填一个」才是错误输入。
 */
function assertUsernamePasswordPairing(username?: string, password?: string) {
  if (Boolean(username) !== Boolean(password)) {
    throw new ValidationError("username and password must both be provided together, or both omitted");
  }
}

export async function createDriver(input: CreateDriverInput) {
  assertUsernamePasswordPairing(input.username, input.password);

  try {
    return await prisma.$transaction(async (tx) => {
      let userId: number | undefined;

      if (input.username && input.password) {
        const driverRole = await tx.role.findUniqueOrThrow({ where: { key: ROLE_KEYS.DRIVER } });
        const user = await tx.user.create({
          data: {
            username: input.username,
            passwordHash: await hashPassword(input.password),
            roleId: driverRole.id
          }
        });
        userId = user.id;
      }

      return tx.driver.create({
        data: {
          name: input.name,
          phone: input.phone,
          vehiclePlateNumber: input.vehiclePlateNumber,
          remark: input.remark,
          userId
        }
      });
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new ConflictError("Username already taken");
    }
    throw err;
  }
}

interface UpdateDriverInput {
  name?: string;
  phone?: string;
  vehiclePlateNumber?: string;
  remark?: string;
}

export async function updateDriver(id: number, input: UpdateDriverInput) {
  await getDriverOrThrow(id);
  return prisma.driver.update({ where: { id }, data: input });
}

export async function setDriverStatus(id: number, status: DriverStatus) {
  await getDriverOrThrow(id);
  return prisma.driver.update({ where: { id }, data: { status } });
}

export async function resetDriverPassword(id: number, newPassword: string) {
  const driver = await getDriverOrThrow(id);
  if (!driver.userId) {
    throw new ConflictError("This driver has no login account to reset");
  }

  await prisma.user.update({
    where: { id: driver.userId },
    data: { passwordHash: await hashPassword(newPassword) }
  });

  return driver;
}

/**
 * 真的从资料库删掉这个 Driver（不是停用）——两层保护：(1) 一定要先停用
 * （status === INACTIVE）才能删，正在使用中的 Driver 不该被删掉；(2) 一定要重新输入
 * 「操作者自己」目前的登入密码才能确认，这不是在验证这个 Driver 的密码，是在确认
 * 「按下删除的这个人真的是本人」，防止有人拿着还没登出的分页手滑删错。
 *
 * 真的执行删除时，Leg/Wallet/Settlement/Collection/GPS/DispatchOffer 这些表对 driver_id
 * 的外键大多是 ON DELETE RESTRICT（业务资料一定要保留完整），只有 Leg 是 SET NULL——
 * 代表一个已经有任何实际业务纪录（哪怕只是上线过一次、被派过一次单）的 Driver，删除
 * 时资料库会直接拒绝（Prisma 丢 P2003），这里接住转成看得懂的错误讯息，不会让 500
 * 或不明确的错误吓到使用者；真正能被删掉的只有从来没有任何活动纪录的 Driver
 * （例如建错的测试帐号）。
 */
export async function deleteDriver(id: number, actorUserId: number, confirmPassword: string) {
  const driver = await getDriverOrThrow(id);

  if (driver.status !== "INACTIVE") {
    throw new ConflictError("Only inactive drivers can be deleted — disable this driver first");
  }

  const actor = await prisma.user.findUnique({ where: { id: actorUserId } });
  if (!actor || !(await verifyPassword(confirmPassword, actor.passwordHash))) {
    throw new ForbiddenError("Current password is incorrect");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const deleted = await tx.driver.delete({ where: { id } });
      // 顺手把绑定的登入帐号也清掉，不留一个「没有 Driver 资料、但还能登入」的孤儿帐号。
      if (deleted.userId) {
        await tx.user.delete({ where: { id: deleted.userId } });
      }
      return deleted;
    });
  } catch (err) {
    // Postgres 的 ON DELETE RESTRICT 违反是 SQLSTATE 23001（restrict_violation），Prisma
    // 只把预设的 23503（foreign_key_violation）映射成有型别的 P2003——这里的外键全部是
    // 明确写 RESTRICT，所以实际丢出来的是没有 code 的 PrismaClientUnknownRequestError，
    // 之前只接 P2003 会漏接这个，变成 500 吓到使用者。
    const isRestrictViolation =
      (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") ||
      (err instanceof Error && err.message.includes("violates RESTRICT setting of foreign key constraint"));
    if (isRestrictViolation) {
      throw new ConflictError(
        "This driver has related records (jobs, wallet, settlement, or GPS history) and cannot be deleted"
      );
    }
    throw err;
  }
}

async function getDriverOrThrow(id: number) {
  const driver = await prisma.driver.findUnique({ where: { id } });
  if (!driver) {
    throw new NotFoundError(`Driver ${id} not found`);
  }
  return driver;
}
