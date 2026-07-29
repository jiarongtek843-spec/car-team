-- CreateTable
CREATE TABLE "activity_logs" (
    "id" SERIAL NOT NULL,
    "module" TEXT NOT NULL,
    "activity_type" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "actor_user_id" INTEGER,
    "actor_driver_id" INTEGER,
    "subject_driver_id" INTEGER,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_logs_entity_type_entity_id_idx" ON "activity_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "activity_logs_module_created_at_idx" ON "activity_logs"("module", "created_at");

-- CreateIndex
CREATE INDEX "activity_logs_subject_driver_id_created_at_idx" ON "activity_logs"("subject_driver_id", "created_at");

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_actor_driver_id_fkey" FOREIGN KEY ("actor_driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_subject_driver_id_fkey" FOREIGN KEY ("subject_driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
