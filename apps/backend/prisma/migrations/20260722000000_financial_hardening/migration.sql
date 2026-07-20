-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "actor_role" "UserRole",
ADD COLUMN     "after_data" JSONB,
ADD COLUMN     "before_data" JSONB;

-- AlterTable: settlement_date -> period_start/period_end. Backfill existing rows
-- (single day settlements) before dropping the old column.
ALTER TABLE "settlements" ADD COLUMN     "period_end" DATE,
ADD COLUMN     "period_start" DATE;

UPDATE "settlements" SET "period_start" = "settlement_date", "period_end" = "settlement_date";

ALTER TABLE "settlements" ALTER COLUMN "period_start" SET NOT NULL,
ALTER COLUMN "period_end" SET NOT NULL;

ALTER TABLE "settlements" DROP COLUMN "settlement_date";

-- AlterTable
ALTER TABLE "wallet_transactions" ADD COLUMN     "related_settlement_id" INTEGER;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_related_settlement_id_fkey" FOREIGN KEY ("related_settlement_id") REFERENCES "settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
