import { prisma } from "../../config/prisma.js";
import { verifyPassword } from "../../common/password.js";
import { AppError } from "../../common/errors.js";

export class AuthError extends AppError {
  constructor(message = "Invalid username or password") {
    super(401, message);
  }
}

const userWithDriverInclude = { driver: true } as const;

export type AuthenticatedUser = Awaited<ReturnType<typeof getActiveUserById>>;

export async function login(username: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { username },
    include: userWithDriverInclude
  });

  if (!user) {
    throw new AuthError();
  }

  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk) {
    throw new AuthError();
  }

  assertUserCanLogIn(user);

  return user;
}

function assertUserCanLogIn(user: { status: string; role: string; driver: { status: string } | null }) {
  if (user.status !== "ACTIVE") {
    throw new AuthError("This account has been disabled");
  }
  if (user.role === "DRIVER" && user.driver?.status !== "ACTIVE") {
    throw new AuthError("This driver account has been disabled");
  }
}

/**
 * 每次受保护请求都从 DB 重新读一次，确保帐号/司机被停用后立刻生效，
 * 不依赖 session 里的旧资料。
 */
export async function getActiveUserById(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: userWithDriverInclude
  });

  if (!user) {
    return null;
  }

  try {
    assertUserCanLogIn(user);
  } catch {
    return null;
  }

  return user;
}

export function sanitizeUser(user: NonNullable<Awaited<ReturnType<typeof getActiveUserById>>>) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    driver: user.driver
      ? {
          id: user.driver.id,
          name: user.driver.name,
          phone: user.driver.phone,
          vehiclePlateNumber: user.driver.vehiclePlateNumber,
          status: user.driver.status
        }
      : null
  };
}
