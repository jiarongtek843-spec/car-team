/**
 * 本地开发用的种子资料，不要在正式环境执行。
 * 用法：npm run db:seed --workspace=apps/backend
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/common/password.js";
import { ROLE_KEYS, type RoleKey } from "../src/common/permissions.js";

const prisma = new PrismaClient();

const DEV_PASSWORD = "DevPass123!";

async function upsertUserWithRole(username: string, roleKey: RoleKey) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  const passwordHash = await hashPassword(DEV_PASSWORD);
  await prisma.user.upsert({
    where: { username },
    update: {},
    create: {
      username,
      passwordHash,
      roleId: role.id
    }
  });
}

async function upsertDriver(username: string, name: string, phone: string, plate: string) {
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return;

  const driverRole = await prisma.role.findUniqueOrThrow({ where: { key: ROLE_KEYS.DRIVER } });
  const passwordHash = await hashPassword(DEV_PASSWORD);
  await prisma.user.create({
    data: {
      username,
      passwordHash,
      roleId: driverRole.id,
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
  await upsertUserWithRole("admin", ROLE_KEYS.OWNER);
  await upsertUserWithRole("manager01", ROLE_KEYS.MANAGER);
  await upsertUserWithRole("dispatcher01", ROLE_KEYS.DISPATCHER);
  await upsertDriver("driver01", "Driver One", "0111111111", "ABC1234");
  await upsertDriver("driver02", "Driver Two", "0122222222", "XYZ5678");

  console.log("Seed complete. Dev-only test accounts:");
  console.log(`  admin        / ${DEV_PASSWORD}  (OWNER)`);
  console.log(`  manager01    / ${DEV_PASSWORD}  (MANAGER)`);
  console.log(`  dispatcher01 / ${DEV_PASSWORD}  (DISPATCHER)`);
  console.log(`  driver01     / ${DEV_PASSWORD}  (DRIVER)`);
  console.log(`  driver02     / ${DEV_PASSWORD}  (DRIVER)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
