-- AlterTable
ALTER TABLE "users" ADD COLUMN "biometric_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_biometric_id_key" ON "users"("biometric_id");

-- CreateIndex
CREATE INDEX "users_biometric_id_idx" ON "users"("biometric_id");

-- CreateTable
CREATE TABLE "biometric_punch_logs" (
    "id" SERIAL NOT NULL,
    "biometric_id" TEXT NOT NULL,
    "user_id" INTEGER,
    "punch_time" TIMESTAMP(3) NOT NULL,
    "direction" TEXT,
    "device_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROCESSED',
    "message" TEXT,
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "biometric_punch_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "biometric_punch_logs_biometric_id_punch_time_device_id_key" ON "biometric_punch_logs"("biometric_id", "punch_time", "device_id");

-- CreateIndex
CREATE INDEX "biometric_punch_logs_biometric_id_idx" ON "biometric_punch_logs"("biometric_id");

-- CreateIndex
CREATE INDEX "biometric_punch_logs_user_id_idx" ON "biometric_punch_logs"("user_id");

-- CreateIndex
CREATE INDEX "biometric_punch_logs_punch_time_idx" ON "biometric_punch_logs"("punch_time");

-- CreateIndex
CREATE INDEX "biometric_punch_logs_created_at_idx" ON "biometric_punch_logs"("created_at");

-- AddForeignKey
ALTER TABLE "biometric_punch_logs" ADD CONSTRAINT "biometric_punch_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
