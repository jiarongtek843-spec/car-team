import { prisma } from "../../config/prisma.js";
import { hashPassword, verifyPassword } from "../../common/password.js";
import { AppError, ConflictError, ValidationError } from "../../common/errors.js";
import type { RoleKey, PermissionKey } from "../../common/permissions.js";

export class AuthError extends AppError {
  constructor(message = "Invalid username or password") {
    super(401, message);
  }
}

const userWithDriverInclude = {
  driver: true,
  role: { include: { permissions: true } }
} as const;

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

function assertUserCanLogIn(user: { status: string; role: { key: string }; driver: { status: string } | null }) {
  if (user.status !== "ACTIVE") {
    throw new AuthError("This account has been disabled");
  }
  if (user.role.key === "DRIVER" && user.driver?.status !== "ACTIVE") {
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

export interface UpdateOwnCredentialsInput {
  currentPassword: string;
  newUsername?: string;
  newPassword?: string;
}

/**
 * 帐号自己改自己的用户名/密码——一定要先验证 currentPassword 才能改，避免有人拿到还没
 * 登出的浏览器分页就直接改掉密码、把原本的使用者锁在外面（等同于要求「重新证明一次
 * 你真的是本人」，跟大多数系统改密码前要求输入原密码是同一个道理）。
 */
export async function updateOwnCredentials(userId: number, input: UpdateOwnCredentialsInput) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: userWithDriverInclude });
  if (!user) {
    throw new AuthError("User not found");
  }

  const currentPasswordOk = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!currentPasswordOk) {
    throw new AuthError("Current password is incorrect");
  }

  const data: { username?: string; passwordHash?: string } = {};

  if (input.newUsername && input.newUsername !== user.username) {
    const existing = await prisma.user.findUnique({ where: { username: input.newUsername } });
    if (existing) {
      throw new ConflictError("This username is already taken");
    }
    data.username = input.newUsername;
  }

  if (input.newPassword) {
    data.passwordHash = await hashPassword(input.newPassword);
  }

  if (Object.keys(data).length === 0) {
    throw new ValidationError("Nothing to update");
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    include: userWithDriverInclude
  });

  return { updated, usernameChanged: Boolean(data.username), passwordChanged: Boolean(data.passwordHash) };
}

export function sanitizeUser(user: NonNullable<Awaited<ReturnType<typeof getActiveUserById>>>) {
  return {
    id: user.id,
    username: user.username,
    role: { key: user.role.key as RoleKey, name: user.role.name },
    permissions: user.role.permissions.map((p) => p.permissionKey) as PermissionKey[],
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
