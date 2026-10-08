const crypto = require("crypto");
const { db } = require("../lib/db");
const { attendanceService } = require("./attendanceService");
const { emitToAdmins, emitToUser } = require("../lib/socket");

/**
 * Parses various date formats commonly provided by Matrix COSEC devices or bridges:
 * - "2026-10-08 09:30:00"
 * - "2026/10/08 09:30:00"
 * - ISO strings
 * - Unix timestamp in seconds or milliseconds
 *
 * Returns null if the timestamp cannot be reliably parsed.
 */
function parseMatrixTimestamp(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === "number") {
    // If timestamp in seconds, convert to milliseconds
    const d = new Date(raw < 1e11 ? raw * 1000 : raw);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === "string") {
    // Replace slash with hyphen if in YYYY/MM/DD format
    const cleaned = raw.trim().replace(/\//g, "-");
    const parsed = new Date(cleaned);
    if (!isNaN(parsed.getTime())) return parsed;

    // Handle "DD-MM-YYYY HH:mm:ss" if present
    const ddmmyyyy = cleaned.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (ddmmyyyy) {
      const [, d, m, y, h, min, s = "00"] = ddmmyyyy;
      const dObj = new Date(`${y}-${m}-${d}T${h}:${min}:${s}`);
      if (!isNaN(dObj.getTime())) return dObj;
    }
  }
  return null;
}

/**
 * Normalizes Matrix Direction codes:
 * Matrix COSEC typically sends:
 * 0 or "0" or "IN" or "ENTRY" => IN
 * 1 or "1" or "OUT" or "EXIT" => OUT
 */
function normalizeDirection(rawDirection) {
  if (rawDirection == null) return "AUTO";
  const str = String(rawDirection).trim().toUpperCase();
  if (str === "0" || str === "IN" || str === "ENTRY" || str === "CHECKIN" || str === "CHECK_IN") {
    return "IN";
  }
  if (str === "1" || str === "OUT" || str === "EXIT" || str === "CHECKOUT" || str === "CHECK_OUT") {
    return "OUT";
  }
  return "AUTO";
}

const matrixBiometricService = {
  /**
   * Verifies the secret token securely using timingSafeEqual.
   */
  verifySecret(providedSecret) {
    const configuredSecret = process.env.MATRIX_WEBHOOK_SECRET;
    if (!configuredSecret) {
      if (process.env.NODE_ENV === "production") {
        return false;
      }
      return true;
    }

    if (!providedSecret || typeof providedSecret !== "string") {
      return false;
    }

    const providedBuf = Buffer.from(providedSecret);
    const configuredBuf = Buffer.from(configuredSecret);

    if (providedBuf.length !== configuredBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(providedBuf, configuredBuf);
  },

  /**
   * Processes a single biometric punch event idempotently.
   * Ensures that repeat punches within the debounce window (default 60s) or duplicate
   * webhook deliveries only happen once.
   */
  async processSinglePunch(rawPunch) {
    const rawBiometricId = rawPunch.UserID ??
      rawPunch.userId ??
      rawPunch.biometricId ??
      rawPunch.EnrollmentID ??
      rawPunch.badgeId;

    if (!rawBiometricId) {
      return {
        success: false,
        status: "INVALID_PAYLOAD",
        message: "Missing UserID / biometricId in payload",
      };
    }

    const punchTime = parseMatrixTimestamp(
      rawPunch.EventTime ??
      rawPunch.eventTime ??
      rawPunch.punchTime ??
      rawPunch.timestamp ??
      rawPunch.dateTime
    );

    if (!punchTime) {
      return {
        success: false,
        status: "INVALID_PAYLOAD",
        message: "Invalid or missing punch timestamp in payload",
      };
    }

    const biometricId = String(rawBiometricId).trim();
    const direction = normalizeDirection(rawPunch.Direction ?? rawPunch.direction);
    const deviceId = String(rawPunch.DeviceID ?? rawPunch.deviceId ?? rawPunch.ControllerName ?? "MATRIX_SCANNER").trim();

    // 1. Debounce check: Has this biometricId been logged in the last 60 seconds?
    // This prevents accidental double finger-scans from double-triggering sessions.
    const sixtySecondsAgo = new Date(punchTime.getTime() - 60_000);
    const sixtySecondsAfter = new Date(punchTime.getTime() + 60_000);

    const recentPunch = await db.biometricPunchLog.findFirst({
      where: {
        biometricId,
        punchTime: {
          gte: sixtySecondsAgo,
          lte: sixtySecondsAfter,
        },
        status: "PROCESSED",
      },
      orderBy: { punchTime: "desc" },
    });

    if (recentPunch) {
      // Record the duplicate punch for audit without changing attendance state
      await db.biometricPunchLog.create({
        data: {
          biometricId,
          userId: recentPunch.userId,
          punchTime,
          direction,
          deviceId,
          status: "IGNORED_DUPLICATE",
          message: `Ignored duplicate punch within 60s window (last punch at ${recentPunch.punchTime.toISOString()})`,
          rawPayload: rawPunch,
        },
      });

      return {
        success: true,
        status: "IGNORED_DUPLICATE",
        message: "Duplicate punch ignored within debounce window",
        biometricId,
        punchTime,
      };
    }

    // 2. Find the employee linked to this biometricId
    const user = await db.user.findFirst({
      where: { biometricId, isActive: true },
      select: { id: true, name: true, department: true, timezone: true, role: true },
    });

    if (!user) {
      // Unmapped user - log for admin review
      await db.biometricPunchLog.create({
        data: {
          biometricId,
          punchTime,
          direction,
          deviceId,
          status: "UNMAPPED_USER",
          message: `No active employee linked to Matrix Biometric ID: ${biometricId}`,
          rawPayload: rawPunch,
        },
      });

      return {
        success: true,
        status: "UNMAPPED_USER",
        message: `Biometric ID ${biometricId} is not mapped to any active employee`,
        biometricId,
      };
    }

    const timezone = user.timezone || "UTC";
    const today = attendanceService.todayDate(timezone, punchTime);

    // 3. Determine Check-In vs Check-Out based on current attendance sessions
    let actionTaken = "NONE";
    let attendanceRecord = null;
    let message = "";

    try {
      const existing = await db.attendance.findUnique({
        where: { userId_date: { userId: user.id, date: today } },
        include: {
          sessions: { orderBy: { checkIn: "asc" } },
        },
      });

      const openSession = existing?.sessions?.find(s => !s.checkOut);

      if (direction === "IN") {
        if (openSession) {
          actionTaken = "SESSION_ALREADY_OPEN";
          message = "Employee already has an active open session. Check-in ignored.";
          attendanceRecord = existing;
        } else {
          attendanceRecord = await attendanceService.checkIn(user.id, {
            timezone,
            punchTime,
            trustedSource: "MATRIX",
            notes: `Matrix Punch (${deviceId})`,
          });
          actionTaken = "CHECK_IN";
          message = `Checked in via Matrix scanner (${deviceId})`;
        }
      } else if (direction === "OUT") {
        if (openSession) {
          attendanceRecord = await attendanceService.checkOut(user.id, {
            timezone,
            punchTime,
            notes: `Matrix Punch (${deviceId})`,
          });
          actionTaken = "CHECK_OUT";
          message = `Checked out via Matrix scanner (${deviceId})`;
        } else {
          actionTaken = "NO_OPEN_SESSION";
          message = "No active session to check out. Check-out punch ignored.";
          attendanceRecord = existing;
        }
      } else {
        // AUTO direction: toggle based on active session
        if (openSession) {
          attendanceRecord = await attendanceService.checkOut(user.id, {
            timezone,
            punchTime,
            notes: `Matrix Auto Punch (${deviceId})`,
          });
          actionTaken = "CHECK_OUT";
          message = `Auto checked out via Matrix scanner (${deviceId})`;
        } else {
          attendanceRecord = await attendanceService.checkIn(user.id, {
            timezone,
            punchTime,
            trustedSource: "MATRIX",
            notes: `Matrix Auto Punch (${deviceId})`,
          });
          actionTaken = "CHECK_IN";
          message = `Auto checked in via Matrix scanner (${deviceId})`;
        }
      }

      // 4. Log successful processing
      const punchLog = await db.biometricPunchLog.create({
        data: {
          biometricId,
          userId: user.id,
          punchTime,
          direction,
          deviceId,
          status: "PROCESSED",
          message: `${actionTaken}: ${message}`,
          rawPayload: rawPunch,
        },
      });

      // Broadcast live event to admins
      emitToAdmins("attendance:biometric_punch", {
        userId: user.id,
        userName: user.name,
        department: user.department,
        biometricId,
        direction,
        actionTaken,
        deviceId,
        punchTime,
      });

      emitToUser(user.id, "attendance:biometric_punch", {
        actionTaken,
        punchTime,
      });

      return {
        success: true,
        status: "PROCESSED",
        actionTaken,
        message,
        userId: user.id,
        userName: user.name,
        punchLogId: punchLog.id,
      };
    } catch (err) {
      console.error("[MatrixBiometric] Error processing punch:", err);

      await db.biometricPunchLog.create({
        data: {
          biometricId,
          userId: user.id,
          punchTime,
          direction,
          deviceId,
          status: "ERROR",
          message: err.message,
          rawPayload: rawPunch,
        },
      });

      return {
        success: false,
        status: "ERROR",
        message: err.message,
        userId: user.id,
      };
    }
  },

  /**
   * Processes a batch of events or single event payload.
   */
  async processPayload(payload) {
    let events = [];
    if (Array.isArray(payload)) {
      events = payload;
    } else if (payload && Array.isArray(payload.events)) {
      events = payload.events;
    } else if (payload) {
      events = [payload];
    }

    const results = [];
    for (const evt of events) {
      const res = await this.processSinglePunch(evt);
      results.push(res);
    }

    return {
      success: true,
      count: results.length,
      processed: results.filter(r => r.status === "PROCESSED").length,
      duplicates: results.filter(r => r.status === "IGNORED_DUPLICATE").length,
      unmapped: results.filter(r => r.status === "UNMAPPED_USER").length,
      results,
    };
  },
};

module.exports = { matrixBiometricService };
