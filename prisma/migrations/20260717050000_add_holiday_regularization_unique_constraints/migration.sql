-- CreateIndex
-- Enforces one company-wide holiday per date (department IS NULL) and one
-- holiday per (date, department) pair for department-scoped holidays.
-- Two partial indexes because Postgres unique constraints treat NULL as
-- "distinct from every other NULL", so a plain UNIQUE(date, department)
-- would let unlimited company-wide holidays stack on the same date.
CREATE UNIQUE INDEX "holidays_date_company_wide_key"
  ON "holidays"("date")
  WHERE "department" IS NULL;

CREATE UNIQUE INDEX "holidays_date_department_key"
  ON "holidays"("date", "department")
  WHERE "department" IS NOT NULL;

-- CreateIndex
-- Enforces at most one PENDING regularization request per (user, date),
-- backing up the findFirst() check in regularizationService.request()
-- which is not atomic under concurrent requests.
CREATE UNIQUE INDEX "attendance_regularizations_user_date_pending_key"
  ON "attendance_regularizations"("user_id", "date")
  WHERE "status" = 'PENDING';