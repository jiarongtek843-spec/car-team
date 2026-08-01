import type { CollectionPaymentMethod, CollectionPurpose, CollectionStatus, Prisma } from "@prisma/client";
import path from "node:path";
import fs from "node:fs";
import { prisma } from "../../config/prisma.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../common/errors.js";
import { writeAuditLog, type AuditActor } from "../../common/audit.js";
import { PERMISSIONS } from "../../common/permissions.js";
import { uploadsRoot } from "../../common/upload.js";
import { endOfLocalDay, parseLocalDateOnly } from "../../common/date.js";
import type { AuthUser } from "../auth/auth.middleware.js";

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
    // Stabilization Bug Fix：跟 dispatch.service.ts 的 Completed 日期 Filter 之前一样，
    // 直接 `new Date(dateFrom)` 会被当成 UTC 午夜解析，伺服器时区不是 UTC 时会悄悄偏移
    // 几个小时，让选定日期边界的资料被误纳入/排除。改用 parseLocalDateOnly/endOfLocalDay，
    // 跟 settlement.service.ts/dispatch.service.ts 共用同一套修法。
    collectedAt: {
      gte: dateFrom ? parseLocalDateOnly(dateFrom) : undefined,
      lte: dateTo ? endOfLocalDay(parseLocalDateOnly(dateTo)) : undefined
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

/**
 * 日结要纳入的代收款：只有 VERIFIED 才算数（Admin 已经确认这笔钱真的收到了），而且只能是
 * collectedBy=DRIVER——Company 直接收款（collectedBy=COMPANY）不构成这个 Driver 的
 * Settlement 负债，绝对不能被算成「Driver 欠公司」（Schema 阶段就留了这个过滤条件给
 * Settlement Module，这里是真正落地的地方）。
 */
export async function getCollectionsInPeriod(driverId: number, periodStart: Date, periodEnd: Date) {
  return prisma.collection.findMany({
    where: {
      driverId,
      collectedBy: "DRIVER",
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
      collectedBy: "DRIVER",
      status: "VERIFIED",
      OR: [{ collectedAt: { lt: periodStart } }, { collectedAt: { gt: endOfDay(periodEnd) } }]
    },
    include: collectionSummaryInclude,
    orderBy: { collectedAt: "asc" }
  });
}

/**
 * Mobile UAT Bug Fix（Driver Collection 纳入 Settlement）：COLLECTED 但还没被 Admin Verify
 * 的代收款，之前完全不会出现在 Settlement Preview 的任何地方（不算 Included、也不算
 * Excluded）——对 Admin 来说等于凭空消失，是「RM1000 代收没算进 Settlement，Driver
 * Collected Amount 却显示 RM0.00」这个 Bug 报告的真正根因。这里刻意不加日期区间限制：
 * 不管这笔钱是哪天代收的，只要还没 Verify，Admin 都得在 Settlement Preview 上看到它、
 * 知道要先去 Verify，而不是被静默忽略。
 */
export async function getUnverifiedCollections(driverId: number) {
  return prisma.collection.findMany({
    where: { driverId, collectedBy: "DRIVER", status: "COLLECTED" },
    include: collectionSummaryInclude,
    orderBy: { collectedAt: "asc" }
  });
}

export function sumCollectionAmountCents(collections: { amountCents: number }[]) {
  return collections.reduce((sum, c) => sum + c.amountCents, 0);
}

interface CollectionSummaryFilters {
  dateFrom?: string;
  dateTo?: string;
}

/**
 * 老板总览用：Collection 总数。只算 VERIFIED/SETTLED（Admin 已经确认这笔钱真的收到了——
 * 跟 getCollectionsInPeriod 同一套「只有 Verify 过才算数」的规则），排除还没 Verify 的
 * COLLECTED/PENDING 跟已经作废的 VOIDED。不像 getCollectionsInPeriod 那样限定
 * collectedBy=DRIVER——这里是公司整体代收总数，Driver 代收跟 Company 直接收款都是
 * 公司真的收到的钱，都该算。
 */
export async function getCollectionSummary({ dateFrom, dateTo }: CollectionSummaryFilters) {
  const result = await prisma.collection.aggregate({
    where: {
      status: { in: ["VERIFIED", "SETTLED"] },
      collectedAt: {
        gte: dateFrom ? parseLocalDateOnly(dateFrom) : undefined,
        lte: dateTo ? endOfLocalDay(parseLocalDateOnly(dateTo)) : undefined
      }
    },
    _sum: { amountCents: true },
    _count: true
  });

  return { totalAmountCents: result._sum.amountCents ?? 0, count: result._count };
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

/**
 * Proof 图片之前是靠 express.static 完全公开挂在 /uploads——任何登入的人（甚至没登入的人，
 * 只要猜得到档名）都能看到任何 Driver 的代收凭证，是真实的权限漏洞。改成这支函式：先确认
 * 这个档名真的对应一笔 Collection，再确认呼叫者是这笔 Collection 的本人 Driver 或是有
 * collection:read 权限的 Admin/Manager，两者都不是才拒绝。找不到对应 Collection、或档案
 * 已经不在磁盘上（例如 Railway 重新部署清空了本地磁盘），都丢 NotFoundError——由呼叫端
 * （collection.controller.ts）统一回 404，前端显示「证明图片已不存在，请重新上传」。
 */
export async function getCollectionProofFilePath(filename: string, authUser: AuthUser): Promise<string> {
  const relativePath = `/uploads/collections/${filename}`;
  const collection = await prisma.collection.findFirst({ where: { proofImageUrl: relativePath } });
  if (!collection) {
    throw new NotFoundError("Proof image not found");
  }

  const isAdmin = authUser.permissions.includes(PERMISSIONS.COLLECTION_READ);
  const isOwningDriver = authUser.driver !== null && collection.driverId === authUser.driver.id;
  if (!isAdmin && !isOwningDriver) {
    throw new ForbiddenError("Not allowed to view this proof image");
  }

  const filePath = path.join(uploadsRoot, "collections", filename);
  if (!fs.existsSync(filePath)) {
    throw new NotFoundError("Proof image file no longer exists on disk");
  }

  return filePath;
}
