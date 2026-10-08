-- AlterTable attendance
ALTER TABLE "attendance" ADD COLUMN "work_mode" TEXT NOT NULL DEFAULT 'WFO';
ALTER TABLE "attendance" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "attendance" ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "attendance" ADD COLUMN "ip_address" TEXT;
ALTER TABLE "attendance" ADD COLUMN "location_verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "attendance" ADD COLUMN "ip_verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "attendance" ADD COLUMN "distance_meters" INTEGER;
ALTER TABLE "attendance" ADD COLUMN "location_name" TEXT;

-- CreateIndex
CREATE INDEX "attendance_work_mode_idx" ON "attendance"("work_mode");

-- AlterTable attendance_sessions
ALTER TABLE "attendance_sessions" ADD COLUMN "work_mode" TEXT NOT NULL DEFAULT 'WFO';
ALTER TABLE "attendance_sessions" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "attendance_sessions" ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "attendance_sessions" ADD COLUMN "ip_address" TEXT;
ALTER TABLE "attendance_sessions" ADD COLUMN "location_verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "attendance_sessions" ADD COLUMN "ip_verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "attendance_sessions" ADD COLUMN "distance_meters" INTEGER;
ALTER TABLE "attendance_sessions" ADD COLUMN "location_name" TEXT;

-- AlterTable attendance_config
ALTER TABLE "attendance_config" ADD COLUMN "enforce_geofence" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "attendance_config" ADD COLUMN "enforce_ip" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable office_locations
CREATE TABLE "office_locations" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radius_meters" INTEGER NOT NULL DEFAULT 200,
    "allowed_ips" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "office_locations_pkey" PRIMARY KEY ("id")
);

-- Seed default headquarters location if no office location exists
INSERT INTO "office_locations" ("name", "latitude", "longitude", "radius_meters", "allowed_ips", "is_active", "updated_at")
VALUES ('Headquarters', 12.9716, 77.5946, 500, ARRAY['127.0.0.1', '::1']::TEXT[], true, CURRENT_TIMESTAMP);
