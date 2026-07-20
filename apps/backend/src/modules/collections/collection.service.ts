import type { CollectionPaymentMethod, CollectionPurpose, CollectionStatus, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ConflictError, NotFoundError, ValidationError } from "../../common/errors.js";
import { writeAuditLog, type AuditActor } from "../../common/audit.js";

type TxClient = Prisma.TransactionClient | typeof prisma;

export const collectionDetailInclude = {
  booking: { select: { id: true, girlName: true } },
  leg: { select: { id: true, sequence: true } },
  driver: { select: { id: true, name: true } },
  createdByUser: { select: { id: true, username: true } },
  verifiedByUser: { select: { id: true, username: true } },
  voidedByUser: { select: { id: true, username: true } },
  settlement: { select: { id: true, reference: true } }
} satisfies Prisma.CollectionInclude;

interface CreateCollectionInput {
  bookingId: number;
  legId?: number;
  driverId: number;
  customerName?: string;
  purpose: CollectionPurpose;
  amountCents: number;
  paymentMethod: CollectionPaymentMethod;
  collectedAt?: string;
  remark?: string;
}

/**
 * Driver 新增一笔代收款。目前没有「Admin 先指派代收任务」的流程，所以创建时直接是
 * COLLECTED（代表钱已经在 Driver 手上），PENDING 保留给未来可能的指派流程用。
 */
export async function createCollection(input: CreateCollectionInput, actor: AuditActor) {
  if (input.amountCents <= 0) {
    throw new ValidationError("Amount must be greater than zero");
  }

  const booking = await prisma.booking.findUnique({ where: { id: input.bookingId } });
  if (!booking) {
    throw new NotFoundError(`Booking ${input.bookingId} not found`);
  }

  if (input.legId) {
    const leg = await prisma.leg.findUnique({ where: { id: input.legId } });
    if (!leg || leg.bookingId !== input.bookingId) {
      throw new ValidationError("Leg does not belong to this booking");
    }
  }

  const collection = await prisma.collection.create({
    data: {
      bookingId: input.bookingId,
      legId: input.legId ?? null,
      driverId: input.driverId,
      customerName: input.customerName,
      purpose: input.purpose,
      amountCents: input.amountCents,
      paymentMethod: input.paymentMethod,
      status: "COLLECTED",
      collectedAt: input.collectedAt ? new Date(input.collectedAt) : new Date(),
      remark: input.remark,
      createdBy: actor.id
    },
    include: collectionDetailInclude
  });

  await writeAuditLog({
    actor,
    action: "COLLECTION_CREATED",
    entityType: "Collection",
    entityId: collection.id,
    afterData: {
      bookingId: input.bookingId,
      legId: input.legId ?? null,
      driverId: input.driverId,
      amountCents: input.amountCents,
      paymentMethod: input.paymentMethod,
      purpose: input.purpose
    }
  });

  return collection;
}

interface ListCollectionsFilters {
  driverId?: number;
  bookingId?: number;
  status?: CollectionStatus;
  paymentMethod?: CollectionPaymentMethod;
  purpose?: CollectionPurpose;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  pageSize: number;
}

export async function listCollections(filters: ListCollectionsFilters) {
  const { driverId, bookingId, status, paymentMethod, purpose, search, dateFrom, dateTo, page, pageSize } = filters;

  const where: Prisma.CollectionWhereInput = {
    driverId,
    bookingId,
    status,
    paymentMethod,
    purpose,
    collectedAt: {
      gte: dateFrom ? new Date(dateFrom) : undefined,
      lte: dateTo ? new Date(dateTo) : undefined
    },
    ...(search
      ? {
          OR: [
            { customerName: { contains: search, mode: "insensitive" as const } },
            { remark: { contains: search, mode: "insensitive" as const } }
          ]
        }
      : {})
  };

  const [data, total] = await Promise.all([
    prisma.collection.findMany({
      where,
      include: collectionDetailInclude,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.collection.count({ where })
  ]);

  return { data, total, page, pageSize };
}

export async function getCollectionById(id: number) {
  const collection = await prisma.collection.findUnique({ where: { id }, include: collectionDetailInclude });
  if (!collection) {
    throw new NotFoundError(`Collection ${id} not found`);
  }
  return collection;
}

const NON_EDITABLE_STATUSES: CollectionStatus[] = ["VERIFIED", "SETTLED", "VOIDED"];

/** Driver 上传收据/转账截图。已经 Verified 之后不能再改（规格要求）。 */
export async function attachProofImage(id: number, driverId: number, proofImageUrl: string, actor: AuditActor) {
  const collection = await prisma.collection.findUnique({ where: { id } });
  if (!collection) {
    throw new NotFoundError(`Collection ${id} not found`);
  }
  if (collection.driverId !== driverId) {
    throw new NotFoundError(`Collection ${id} not found`);
  }
  if (NON_EDITABLE_STATUSES.includes(collection.status)) {
    throw new ConflictError(`Cannot modify a collection that is already ${collection.status}`);
  }

  const updated = await prisma.collection.update({
    where: { id },
    data: { proofImageUrl },
    include: collectionDetailInclude
  });

  await writeAuditLog({
    actor,
    action: "COLLECTION_PROOF_UPLOADED",
    entityType: "Collection",
    entityId: id,
    afterData: { proofImageUrl }
  });

  return updated;
}

/** 只有 COLLECTED 能被 Verify；条件式 UPDATE 保证重复呼叫（重复 Verify）第二次会失败。 */
export async function verifyCollection(id: number, actor: AuditActor) {
  const existing = await prisma.collection.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError(`Collection ${id} not found`);
  }

  const result = await prisma.collection.updateMany({
    where: { id, status: "COLLECTED" },
    data: { status: "VERIFIED", verifiedAt: new Date(), verifiedBy: actor.id }
  });

  if (result.count !== 1) {
    throw new ConflictError(`Only a COLLECTED collection can be verified (current status: ${existing.status})`);
  }

  await writeAuditLog({
    actor,
    action: "COLLECTION_VERIFIED",
    entityType: "Collection",
    entityId: id,
    beforeData: { status: "COLLECTED" },
    afterData: { status: "VERIFIED" }
  });

  return getCollectionById(id);
}

/** SETTLED 的 Collection 不能直接 Void，要撤销要走 Void Settlement（会把 Collection 打回 VERIFIED）。 */
export async function voidCollection(id: number, reason: string, actor: AuditActor) {
  const existing = await prisma.collection.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError(`Collection ${id} not found`);
  }
  if (existing.status === "SETTLED") {
    throw new ConflictError("Cannot void a collection that has already been settled; void the settlement instead");
  }

  const result = await prisma.collection.updateMany({
    where: { id, status: { in: ["PENDING", "COLLECTED", "VERIFIED"] } },
    data: { status: "VOIDED", voidedAt: new Date(), voidedBy: actor.id, voidReason: reason }
  });

  if (result.count !== 1) {
    throw new ConflictError(`Collection was already voided or modified by another request (current status: ${existing.status})`);
  }

  await writeAuditLog({
    actor,
    action: "COLLECTION_VOIDED",
    entityType: "Collection",
    entityId: id,
    beforeData: { status: existing.status },
    afterData: { status: "VOIDED", reason }
  });

  return getCollectionById(id);
}

const collectionSummaryInclude = {
  booking: { select: { id: true, girlName: true } },
  leg: { select: { id: true, sequence: true } }
} satisfies Prisma.CollectionInclude;

/**
 * periodEnd 传进来时是 startOfDay（跟 WalletTransaction 的 effectiveDate 是纯日期栏位不同，
 * Collection.collectedAt 是完整的日期时间），要补到当天 23:59:59.999 才不会把「今天下午收的钱」
 * 误判成落在周期之外。
 */
function endOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** 日结要纳入的代收款：只有 VERIFIED 才算数（Admin 已经确认这笔钱真的收到了）。 */
export async function getCollectionsInPeriod(driverId: number, periodStart: Date, periodEnd: Date) {
  return prisma.collection.findMany({
    where: {
      driverId,
      status: "VERIFIED",
      collectedAt: { gte: periodStart, lte: endOfDay(periodEnd) }
    },
    include: collectionSummaryInclude,
    orderBy: { collectedAt: "asc" }
  });
}

export async function getCollectionsOutsidePeriod(driverId: number, periodStart: Date, periodEnd: Date) {
  return prisma.collection.findMany({
    where: {
      driverId,
      status: "VERIFIED",
      OR: [{ collectedAt: { lt: periodStart } }, { collectedAt: { gt: endOfDay(periodEnd) } }]
    },
    include: collectionSummaryInclude,
    orderBy: { collectedAt: "asc" }
  });
}

export function sumCollectionAmountCents(collections: { amountCents: number }[]) {
  return collections.reduce((sum, c) => sum + c.amountCents, 0);
}

/**
 * Void Settlement 时呼叫：把这个 Settlement 底下的 Collection 从 SETTLED 打回 VERIFIED，
 * 让它们能被纳入下一次日结。跟 WalletTransaction 的反向纪录做法不同——Collection.status
 * 单纯是工作流程状态，不是不可变金额帐本，所以直接复原状态即可，不需要另开一笔反向纪录。
 */
export async function reopenCollectionsForVoidedSettlement(client: TxClient, settlementId: number, expectedCount: number) {
  if (expectedCount === 0) {
    return;
  }
  const result = await client.collection.updateMany({
    where: { settlementId, status: "SETTLED" },
    data: { status: "VERIFIED", settledAt: null, settlementId: null }
  });
  if (result.count !== expectedCount) {
    throw new ConflictError("Collections linked to this settlement were already modified by another request");
  }
}
