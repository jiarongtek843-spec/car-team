import type { DriverStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { hashPassword } from "../../common/password.js";
import { ConflictError, NotFoundError } from "../../common/errors.js";
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

export async function createDriver(input: CreateDriverInput) {
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

async function getDriverOrThrow(id: number) {
  const driver = await prisma.driver.findUnique({ where: { id } });
  if (!driver) {
    throw new NotFoundError(`Driver ${id} not found`);
  }
  return driver;
}
