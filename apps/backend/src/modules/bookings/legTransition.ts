import type { LegStatus, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ConflictError, NotFoundError } from "../../common/errors.js";

type LegClient = Prisma.TransactionClient | typeof prisma;

interface TransitionOptions {
  legId: number;
  /** 若提供，代表这是 Driver 发起的动作，同时用来验证这段 Leg 是不是他自己的。 */
  driverId?: number;
  fromStatuses: LegStatus[];
  data: Prisma.LegUncheckedUpdateManyInput;
  /** 需要跟其他写入（例如产生 Wallet Transaction）绑在同一个 DB Transaction 时传入。 */
  client?: LegClient;
}

/**
 * 用「WHERE 状态在期望范围内」的条件式 update 来做状态转换，
 * 一次 SQL 内完成检查+更新，天然避免两个人同时抢同一个 Leg、重复 Accept 等竞态问题。
 * 改动笔数不是 1 就代表状态已经被别人改过或这段 Leg 不属于这个 Driver，直接报错。
 */
export async function applyLegTransition({ legId, driverId, fromStatuses, data, client = prisma }: TransitionOptions) {
  const where: Prisma.LegWhereInput = { id: legId, status: { in: fromStatuses } };
  if (driverId !== undefined) {
    where.driverId = driverId;
  }

  const result = await client.leg.updateMany({ where, data });

  if (result.count !== 1) {
    const leg = await client.leg.findUnique({ where: { id: legId } });
    if (!leg || (driverId !== undefined && leg.driverId !== driverId)) {
      throw new NotFoundError(`Leg ${legId} not found`);
    }
    throw new ConflictError(
      `Leg is currently ${leg.status}, expected one of: ${fromStatuses.join(", ")}`
    );
  }

  return client.leg.findUniqueOrThrow({ where: { id: legId } });
}
