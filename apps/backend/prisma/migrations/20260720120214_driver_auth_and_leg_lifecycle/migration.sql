-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'DRIVER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- AlterEnum
BEGIN;
CREATE TYPE "LegStatus_new" AS ENUM ('PENDING', 'ASSIGNED', 'ACCEPTED', 'DRIVER_ARRIVING', 'PASSENGER_ON_BOARD', 'COMPLETED', 'REJECTED', 'CANCELLED');
ALTER TABLE "public"."legs" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "legs" ALTER COLUMN "status" TYPE "LegStatus_new" USING ("status"::text::"LegStatus_new");
ALTER TYPE "LegStatus" RENAME TO "LegStatus_old";
ALTER TYPE "LegStatus_new" RENAME TO "LegStatus";
DROP TYPE "public"."LegStatus_old";
ALTER TABLE "legs" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- AlterTable
ALTER TABLE "drivers" ADD COLUMN     "remark" TEXT,
ADD COLUMN     "user_id" INTEGER,
ADD COLUMN     "vehicle_plate_number" TEXT;

-- AlterTable
ALTER TABLE "legs" ADD COLUMN     "accepted_at" TIMESTAMP(3),
ADD COLUMN     "assigned_at" TIMESTAMP(3),
ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "driver_arriving_at" TIMESTAMP(3),
ADD COLUMN     "passenger_on_board_at" TIMESTAMP(3),
ADD COLUMN     "rejected_at" TIMESTAMP(3),
ADD COLUMN     "rejection_reason" TEXT;

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "actor_user_id" INTEGER,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_user_id_key" ON "drivers"("user_id");

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

