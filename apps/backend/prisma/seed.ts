/**
 * 本地开发用的种子资料，不要在正式环境执行。
 * 用法：npm run db:seed --workspace=apps/backend
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/common/password.js";

const prisma = new PrismaClient();

const DEV_PASSWORD = "DevPass123!";

async function upsertAdmin() {
  const passwordHash = await hashPassword(DEV_PASSWORD);
  await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      passwordHash,
      role: "ADMIN"
    }
  });
}

async function upsertDriver(username: string, name: string, phone: string, plate: string) {
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return;

  const passwordHash = await hashPassword(DEV_PASSWORD);
  await prisma.user.create({
    data: {
      username,
      passwordHash,
      role: "DRIVER",
      driver: {
        create: {
          name,
          phone,
          vehiclePlateNumber: plate
        }
      }
    }
  });
}

async function main() {
  await upsertAdmin();
  await upsertDriver("driver01", "Driver One", "0111111111", "ABC1234");
  await upsertDriver("driver02", "Driver Two", "0122222222", "XYZ5678");

  console.log("Seed complete. Dev-only test accounts:");
  console.log(`  admin    / ${DEV_PASSWORD}`);
  console.log(`  driver01 / ${DEV_PASSWORD}`);
  console.log(`  driver02 / ${DEV_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
