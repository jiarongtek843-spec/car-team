/**
 * 种子资料：本地开发环境跟 Railway Staging 测试帐号共用同一份脚本，不要在正式环境执行。
 * 用法：npm run db:seed --workspace=apps/backend
 *
 * 安全防呆：APP_ENV=production 时直接拒绝执行（见下方 main() 开头），避免测试帐号被误建
 * 进正式资料库。APP_ENV 是跟 NODE_ENV 分开的独立开关，见 src/config/env.ts 的说明。
 *
 * 密码：本地开发直接用固定的 DEV_PASSWORD（沿用既有习惯，不需要额外设定）；Railway Staging
 * 部署时透过 SEED_PASSWORD 环境变量覆写成 staging 专用密码，不跟本地开发共用、也不会被
 * commit 进 git（真实密码只存在 Railway 的环境变量里）。
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/common/password.js";
import { ROLE_KEYS, type RoleKey } from "../src/common/permissions.js";
import { env } from "../src/config/env.js";

const prisma = new PrismaClient();

const DEV_PASSWORD = process.env.SEED_PASSWORD ?? "DevPass123!";

async function upsertUserWithRole(username: string, roleKey: RoleKey) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  const passwordHash = await hashPassword(DEV_PASSWORD);
  // update 也要写 passwordHash，不能是空物件：这支脚本要能重复执行去「重设」测试帐号密码
  // （例如 Staging 要轮替 SEED_PASSWORD），用空 update 的话，帐号一旦已经存在，密码就永远
  // 卡在第一次建立时的值，跟 SEED_PASSWORD 之后怎么改都对不上。
  await prisma.user.upsert({
    where: { username },
    update: { passwordHash, roleId: role.id },
    create: {
      username,
      passwordHash,
      roleId: role.id
    }
  });
}

async function upsertDriver(username: string, name: string, phone: string, plate: string) {
  const existing = await prisma.user.findUnique({ where: { username } });
  const passwordHash = await hashPassword(DEV_PASSWORD);

  if (existing) {
    // 同样的理由：重复执行要能重设密码，但 Driver 的资料（name/phone/plate）不重建，
    // 避免覆盖掉之后可能在 Admin 端另外改过的资料。
    await prisma.user.update({ where: { username }, data: { passwordHash } });
    return;
  }

  const driverRole = await prisma.role.findUniqueOrThrow({ where: { key: ROLE_KEYS.DRIVER } });
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
  if (env.appEnv === "production") {
    console.error("Refusing to run: APP_ENV=production. Seed data must never be written to a production database.");
    process.exitCode = 1;
    return;
  }

  await upsertUserWithRole("admin", ROLE_KEYS.OWNER);
  await upsertUserWithRole("manager01", ROLE_KEYS.MANAGER);
  await upsertUserWithRole("dispatcher01", ROLE_KEYS.DISPATCHER);
  await upsertDriver("driver01", "Driver One", "0111111111", "ABC1234");
  await upsertDriver("driver02", "Driver Two", "0122222222", "XYZ5678");

  const usingCustomPassword = Boolean(process.env.SEED_PASSWORD);
  console.log("Seed complete. Test accounts: admin (OWNER), manager01 (MANAGER), dispatcher01 (DISPATCHER), driver01 / driver02 (DRIVER).");
  if (usingCustomPassword) {
    // Staging：密码来自 SEED_PASSWORD 环境变量，操作的人本来就知道自己设了什么，不重复印出来，
    // 避免密码明文留在 Railway 的部署/执行 log 里（见本文件顶部注解）。
    console.log("Password: see the SEED_PASSWORD you configured — not printed here for staging.");
  } else {
    // 本地开发用固定的公开密码（README 已经写明，本来就不是秘密），照旧印出来方便复制。
    console.log(`Password (local dev only): ${DEV_PASSWORD}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
