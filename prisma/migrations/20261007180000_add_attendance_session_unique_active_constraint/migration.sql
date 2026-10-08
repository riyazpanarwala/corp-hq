-- CreateIndex
-- Enforces at most one active (open) session per attendance record (check_out IS NULL),
-- preventing race conditions and concurrent duplicate check-ins at the database level.
CREATE UNIQUE INDEX "attendance_sessions_attendance_id_active_key"
  ON "attendance_sessions"("attendance_id")
  WHERE "check_out" IS NULL;
