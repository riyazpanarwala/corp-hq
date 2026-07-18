ALTER TABLE "users" ADD COLUMN "manager_id" INTEGER;

CREATE INDEX "users_manager_id_idx" ON "users"("manager_id");

ALTER TABLE "users"
ADD CONSTRAINT "users_manager_id_fkey"
FOREIGN KEY ("manager_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "users"
ADD CONSTRAINT "users_manager_not_self"
CHECK ("manager_id" IS NULL OR "manager_id" <> "id");
