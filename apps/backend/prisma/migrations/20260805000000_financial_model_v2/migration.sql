-- ============================================================
-- Module 9: Financial Model v2
-- 见 docs/design/financial-model-v2.md 与 docs/design/database-schema-v2.md
--
-- 操作顺序：
--   1) 建新 enum -> 2) 既有 enum 加值 -> 3) 建 4 张新表（含索引/CHECK/Partial Unique）
--   -> 4) Seed charge_types -> 5) bookings 加 financial_status + backfill
--   -> 6) wallet_transactions 加 source/trip_expense_id/booking_charge_id + backfill
--   -> 7) collections 加 related_charge_id/expected_amount_cents/parent_collection_id
--   -> 8) 全部新 Foreign Key 约束
-- 全程不删除、不修改任何既有栏位或既有资料，纯 Additive（见 database-schema-v2.md 第 7 章）。
-- ============================================================

-- 1) 新增 enum
CREATE TYPE "WalletTransactionSource" AS ENUM ('BOOKING_REVENUE', 'TRIP_EXPENSE', 'MANUAL', 'SETTLEMENT_CORRECTION');
CREATE TYPE "BookingFinancialStatus" AS ENUM ('OPEN', 'ACCRUING', 'FINALIZED', 'VOIDED');
CREATE TYPE "ChargeAdjustmentType" AS ENUM ('NONE', 'ADDITION', 'REVERSAL');
CREATE TYPE "TripExpenseType" AS ENUM ('TOLL', 'PARKING', 'FUEL', 'OTHER');
CREATE TYPE "TripExpensePaidBy" AS ENUM ('COMPANY', 'DRIVER');
CREATE TYPE "TripExpenseStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'REIMBURSED', 'VOIDED');
CREATE TYPE "RevenueSnapshotTrigger" AS ENUM ('BOOKING_FINALIZED');

-- 2) 既有 enum 新增一个值（Additive，不影响既有资料/既有值）
ALTER TYPE "WalletTransactionType" ADD VALUE 'EXPENSE_REIMBURSEMENT';

-- 3) 新增 4 张表
CREATE TABLE "charge_types" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "participates_in_revenue_sharing" BOOLEAN NOT NULL DEFAULT false,
    "is_company_revenue" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "charge_types_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "charge_types_key_key" ON "charge_types"("key");
CREATE INDEX "charge_types_active_idx" ON "charge_types"("active");

CREATE TABLE "booking_charges" (
    "id" SERIAL NOT NULL,
    "booking_id" INTEGER NOT NULL,
    "leg_id" INTEGER,
    "charge_type_id" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "description" TEXT,
    "commission_type" "CommissionType",
    "commission_value" INTEGER,
    "adjustment_type" "ChargeAdjustmentType" NOT NULL DEFAULT 'NONE',
    "adjusts_charge_id" INTEGER,
    "adjustment_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER,

    CONSTRAINT "booking_charges_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "booking_charges_booking_id_idx" ON "booking_charges"("booking_id");
CREATE INDEX "booking_charges_leg_id_idx" ON "booking_charges"("leg_id");
CREATE INDEX "booking_charges_charge_type_id_idx" ON "booking_charges"("charge_type_id");
CREATE INDEX "booking_charges_adjusts_charge_id_idx" ON "booking_charges"("adjusts_charge_id");
CREATE INDEX "booking_charges_charge_type_id_created_at_idx" ON "booking_charges"("charge_type_id", "created_at");

-- adjustment_type 跟 adjusts_charge_id 的搭配一致性：NONE 一定没有指向，ADDITION/REVERSAL
-- 一定要有指向。Prisma schema 语法本身不支援任意 CHECK constraint，这里手写。
ALTER TABLE "booking_charges" ADD CONSTRAINT "booking_charges_adjustment_consistency"
  CHECK (
    ("adjustment_type" = 'NONE' AND "adjusts_charge_id" IS NULL)
    OR ("adjustment_type" IN ('ADDITION', 'REVERSAL') AND "adjusts_charge_id" IS NOT NULL)
  );

-- Partial Unique Index：同一笔原始 Charge 最多只能有一笔 REVERSAL（不能被冲销两次），
-- 但可以有多笔 ADDITION（多次补收）——一般的 UNIQUE 约束做不到这种「只限制其中一种」的情况，
-- 用 WHERE 条件的 Partial Unique Index 才能精确表达。
CREATE UNIQUE INDEX "booking_charges_reversal_unique" ON "booking_charges"("adjusts_charge_id") WHERE "adjustment_type" = 'REVERSAL';

CREATE TABLE "trip_expenses" (
    "id" SERIAL NOT NULL,
    "booking_id" INTEGER NOT NULL,
    "leg_id" INTEGER,
    "expense_type" "TripExpenseType" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "paid_by" "TripExpensePaidBy" NOT NULL,
    "reimbursement_required" BOOLEAN NOT NULL DEFAULT false,
    "proof_image_url" TEXT,
    "description" TEXT,
    "status" "TripExpenseStatus" NOT NULL DEFAULT 'PENDING',
    "reverses_expense_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER,
    "verified_at" TIMESTAMP(3),
    "verified_by" INTEGER,
    "rejected_at" TIMESTAMP(3),
    "rejected_by" INTEGER,
    "rejection_reason" TEXT,
    "voided_at" TIMESTAMP(3),
    "voided_by" INTEGER,
    "void_reason" TEXT,

    CONSTRAINT "trip_expenses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "trip_expenses_booking_id_idx" ON "trip_expenses"("booking_id");
CREATE INDEX "trip_expenses_leg_id_idx" ON "trip_expenses"("leg_id");
CREATE INDEX "trip_expenses_status_idx" ON "trip_expenses"("status");
CREATE INDEX "trip_expenses_paid_by_reimbursement_required_idx" ON "trip_expenses"("paid_by", "reimbursement_required");
CREATE UNIQUE INDEX "trip_expenses_reverses_expense_id_key" ON "trip_expenses"("reverses_expense_id");

CREATE TABLE "revenue_sharing_snapshots" (
    "id" SERIAL NOT NULL,
    "booking_id" INTEGER NOT NULL,
    "triggered_by" "RevenueSnapshotTrigger" NOT NULL,
    "company_revenue_cents" INTEGER NOT NULL,
    "driver_pool_cents" INTEGER NOT NULL,
    "charge_breakdown" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_sharing_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "revenue_sharing_snapshots_booking_id_key" ON "revenue_sharing_snapshots"("booking_id");

-- 4) Seed charge_types——第一版只 Seed 这 4 个：Toll/Parking/Fuel 属于 Trip Expense 不是
--    Booking Charge，Discount 暂不开发只保留 adjusts_charge_id 未来可指向的架构位置。
INSERT INTO "charge_types" ("key", "label", "participates_in_revenue_sharing", "is_company_revenue", "created_at", "updated_at") VALUES
  ('FARE', '车资', true, false, NOW(), NOW()),
  ('SURCHARGE', '加价（深夜/节假日/高需求）', true, false, NOW(), NOW()),
  ('EXTRA_SERVICE', '额外服务（绕路/等待等）', true, false, NOW(), NOW()),
  ('PERSONAL_TIP', '客户小费', false, false, NOW(), NOW());

-- 5) bookings 新增 financial_status，先套用默认值 OPEN，再依优先级规则 backfill 既有资料
--    （见 docs/design/database-schema-v2.md 第 9 章，判断顺序很重要：CANCELLED 一定要
--    最先判断，因为一张已取消的 Booking 仍然可能有 COMPLETED 的 Leg 或 WalletTransaction，
--    不能被误判成 FINALIZED）。这条 UPDATE 是纯函数、幂等，可以重复安全执行。
ALTER TABLE "bookings" ADD COLUMN "financial_status" "BookingFinancialStatus" NOT NULL DEFAULT 'OPEN';
CREATE INDEX "bookings_financial_status_idx" ON "bookings"("financial_status");

UPDATE "bookings" b
SET "financial_status" = CASE
  WHEN b."status" = 'CANCELLED' THEN 'VOIDED'::"BookingFinancialStatus"
  WHEN EXISTS (SELECT 1 FROM "legs" l WHERE l."booking_id" = b."id" AND l."status" = 'COMPLETED')
    OR EXISTS (SELECT 1 FROM "wallet_transactions" wt WHERE wt."booking_id" = b."id")
    OR EXISTS (SELECT 1 FROM "collections" c WHERE c."booking_id" = b."id" AND c."settlement_id" IS NOT NULL)
    THEN 'FINALIZED'::"BookingFinancialStatus"
  ELSE 'OPEN'::"BookingFinancialStatus"
END;

-- 6) wallet_transactions 新增 source（backfill 后收紧成 NOT NULL）+ trip_expense_id + booking_charge_id
ALTER TABLE "wallet_transactions" ADD COLUMN "source" "WalletTransactionSource";
ALTER TABLE "wallet_transactions" ADD COLUMN "trip_expense_id" INTEGER;
ALTER TABLE "wallet_transactions" ADD COLUMN "booking_charge_id" INTEGER;

-- 注意：这里刻意不写 WHEN 'EXPENSE_REIMBURSEMENT' 分支——这个 enum 值是本次 migration
-- 才新增的，Postgres 不允许在同一个事务里使用刚新增的 enum 值（会报
-- "unsafe use of new value" 错误），而且这个分支本来就不会有任何既有资料命中
-- （这个值在这次 migration 之前根本不存在），所以省略完全不影响正确性；
-- 之后应用程式建立 EXPENSE_REIMBURSEMENT 交易时，会在 Backend 直接把 source 设成
-- TRIP_EXPENSE，不依赖这条 backfill。
UPDATE "wallet_transactions"
SET "source" = CASE "transaction_type"
  WHEN 'LEG_EARNING' THEN 'BOOKING_REVENUE'::"WalletTransactionSource"
  WHEN 'MANUAL_ADJUSTMENT' THEN 'MANUAL'::"WalletTransactionSource"
  WHEN 'SETTLEMENT_ADJUSTMENT' THEN 'SETTLEMENT_CORRECTION'::"WalletTransactionSource"
END;

ALTER TABLE "wallet_transactions" ALTER COLUMN "source" SET NOT NULL;

CREATE UNIQUE INDEX "wallet_transactions_trip_expense_id_key" ON "wallet_transactions"("trip_expense_id");
CREATE INDEX "wallet_transactions_source_idx" ON "wallet_transactions"("source");
CREATE INDEX "wallet_transactions_booking_charge_id_idx" ON "wallet_transactions"("booking_charge_id");

-- 7) collections 新增 Partial Collection 相关栏位，全部可选，不需要 backfill
ALTER TABLE "collections" ADD COLUMN "related_charge_id" INTEGER;
ALTER TABLE "collections" ADD COLUMN "expected_amount_cents" INTEGER;
ALTER TABLE "collections" ADD COLUMN "parent_collection_id" INTEGER;
CREATE INDEX "collections_related_charge_id_idx" ON "collections"("related_charge_id");
CREATE INDEX "collections_parent_collection_id_idx" ON "collections"("parent_collection_id");

-- 8) 全部新 Foreign Key 约束
ALTER TABLE "booking_charges" ADD CONSTRAINT "booking_charges_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_charges" ADD CONSTRAINT "booking_charges_leg_id_fkey" FOREIGN KEY ("leg_id") REFERENCES "legs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "booking_charges" ADD CONSTRAINT "booking_charges_charge_type_id_fkey" FOREIGN KEY ("charge_type_id") REFERENCES "charge_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_charges" ADD CONSTRAINT "booking_charges_adjusts_charge_id_fkey" FOREIGN KEY ("adjusts_charge_id") REFERENCES "booking_charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_charges" ADD CONSTRAINT "booking_charges_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_leg_id_fkey" FOREIGN KEY ("leg_id") REFERENCES "legs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_reverses_expense_id_fkey" FOREIGN KEY ("reverses_expense_id") REFERENCES "trip_expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_rejected_by_fkey" FOREIGN KEY ("rejected_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "revenue_sharing_snapshots" ADD CONSTRAINT "revenue_sharing_snapshots_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_trip_expense_id_fkey" FOREIGN KEY ("trip_expense_id") REFERENCES "trip_expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_booking_charge_id_fkey" FOREIGN KEY ("booking_charge_id") REFERENCES "booking_charges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "collections" ADD CONSTRAINT "collections_related_charge_id_fkey" FOREIGN KEY ("related_charge_id") REFERENCES "booking_charges"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "collections" ADD CONSTRAINT "collections_parent_collection_id_fkey" FOREIGN KEY ("parent_collection_id") REFERENCES "collections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
