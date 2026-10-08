-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" SERIAL NOT NULL,
    "attendance_id" INTEGER NOT NULL,
    "check_in" TIMESTAMP(3) NOT NULL,
    "check_out" TIMESTAMP(3),
    "check_in_tz" TEXT,
    "check_out_tz" TEXT,
    "hours_worked" DECIMAL(5,2),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_sessions_attendance_id_idx" ON "attendance_sessions"("attendance_id");

-- CreateIndex
CREATE INDEX "attendance_sessions_check_in_idx" ON "attendance_sessions"("check_in");

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill existing attendance records into attendance_sessions
INSERT INTO "attendance_sessions" (
    "attendance_id",
    "check_in",
    "check_out",
    "check_in_tz",
    "check_out_tz",
    "hours_worked",
    "notes",
    "created_at",
    "updated_at"
)
SELECT
    "id",
    "check_in",
    "check_out",
    "check_in_tz",
    "check_out_tz",
    "hours_worked",
    "notes",
    "created_at",
    "updated_at"
FROM "attendance"
WHERE "check_in" IS NOT NULL;
