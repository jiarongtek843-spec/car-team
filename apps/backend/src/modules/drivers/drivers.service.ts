import { prisma } from "../../config/prisma.js";
import type { DriverStatus } from "@prisma/client";

export function listDrivers(status?: DriverStatus) {
  return prisma.driver.findMany({
    where: status ? { status } : undefined,
    orderBy: { name: "asc" }
  });
}

export function createDriver(input: { name: string; phone?: string }) {
  return prisma.driver.create({
    data: { name: input.name, phone: input.phone }
  });
}
