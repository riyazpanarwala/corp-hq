const crypto = require("crypto");
const { db } = require("../lib/db");
const { attendanceService, zonedDateTimeToUtc } = require("./attendanceService");
const { runTransaction } = require("../lib/transaction");
const { emitToAdmins, emitToUser } = require("../lib/socket");

/**
 * Parses raw scanner timestamp string or number into a UTC Date object using the specified timezone.
 * Handles ISO timestamps with offsets, local date/time patterns, and timestamps with zone offsets.
 *
 * @param {string|number|Date} raw - Raw timestamp from scanner punch payload
 * @param {string} [timezone="UTC"] - Target IANA timezone identifier
 * @returns {Date|null} Parsed UTC Date or null if invalid
 */
function parseMatrixTimestamp(raw, timezone = "UTC") {
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === "number") {
    const date = new Date(raw < 1e11 ? raw * 1000 : raw);
    return isNaN(date.getTime()) ? null : date;
  }
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/\//g, "-");
  if (/[ T].*(?:Z|[+-]\d{2}:?\d{2})$/i.test(cleaned)) {
    const date = new Date(cleaned.replace(" ", "T"));
    return isNaN(date.getTime()) ? null : date;
  }
  const iso = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
  const local = cleaned.match(/^(\d{2})-(\d{2})-(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!iso && !local) return null;
  const [, year, month, day, hour, minute, second = "00", millis = "0"] = iso || [local[0], local[3], local[2], local[1], ...local.slice(4)];
  if (+hour > 23 || +minute > 59 || +second > 59) return null;
  const datePart = `${year}-${month}-${day}`;
  const timePart = `${hour}:${minute}:${second}`;
  try {
    const date = zonedDateTimeToUtc(datePart, timePart, timezone);
    // Reject invalid calendar dates and wall times skipped by a DST transition.
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(date).map(p => [p.type, p.value]));
    if (`${parts.year}-${parts.month}-${parts.day}` !== datePart || `${parts.hour}:${parts.minute}:${parts.second}` !== timePart) return null;
    return new Date(date.getTime() + Number(millis.padEnd(3, "0")));
  } catch {
    return null;
  }
}

/**
 * Normalizes punch direction strings into IN, OUT, or AUTO.
 *
 * @param {string|number} raw - Raw direction identifier from punch payload
 * @returns {"IN"|"OUT"|"AUTO"} Normalized direction
 */
function normalizeDirection(raw) {
  const direction = String(raw ?? "AUTO").trim().toUpperCase();
  if (["0", "IN", "ENTRY", "CHECKIN", "CHECK_IN"].includes(direction)) return "IN";
  if (["1", "OUT", "EXIT", "CHECKOUT", "CHECK_OUT"].includes(direction)) return "OUT";
  return "AUTO";
}

const matrixBiometricService = {
  /**
   * Verifies the webhook secret token using timing-safe comparison.
   *
   * @param {string} providedSecret - Secret passed in header or payload
   * @returns {boolean} True if secret matches configured MATRIX_WEBHOOK_SECRET
   */
  verifySecret(providedSecret) {
    const configuredSecret = process.env.MATRIX_WEBHOOK_SECRET;
    if (!configuredSecret) return process.env.NODE_ENV !== "production";
    if (!providedSecret || typeof providedSecret !== "string") return false;
    const provided = Buffer.from(providedSecret);
    const configured = Buffer.from(configuredSecret);
    return provided.length === configured.length && crypto.timingSafeEqual(provided, configured);
  },

  /**
   * Processes an individual raw biometric punch transactionally.
   * Resolves employee mapping, deduplicates nearby punches, applies check-in or checkout,
   * and records a BiometricPunchLog entry.
   *
   * @param {object} rawPunch - Raw punch event object from Matrix scanner or webhook
   * @returns {Promise<object>} Processing outcome with status, actionTaken, and IDs
   */
  async processSinglePunch(rawPunch) {
    const rawId = rawPunch?.UserID ?? rawPunch?.userId ?? rawPunch?.biometricId ?? rawPunch?.EnrollmentID ?? rawPunch?.badgeId;
    const biometricId = String(rawId ?? "").trim();
    if (!biometricId) return { success: false, status: "INVALID_PAYLOAD", message: "Missing UserID / biometricId in payload" };
    const user = await db.user.findFirst({
      where: { biometricId, isActive: true },
      select: { id: true, name: true, department: true, timezone: true },
    });
    const timezone = process.env.MATRIX_TIMEZONE || user?.timezone || "UTC";
    const punchTime = parseMatrixTimestamp(rawPunch.EventTime ?? rawPunch.eventTime ?? rawPunch.punchTime ?? rawPunch.timestamp ?? rawPunch.dateTime, timezone);
    if (!punchTime) return { success: false, status: "INVALID_PAYLOAD", message: "Invalid or missing punch timestamp or scanner timezone" };
    const direction = normalizeDirection(rawPunch.Direction ?? rawPunch.direction);
    const deviceId = String(rawPunch.DeviceID ?? rawPunch.deviceId ?? rawPunch.ControllerName ?? "MATRIX_SCANNER").trim();
    const key = { biometricId, punchTime, deviceId };
    const data = { ...key, userId: user?.id, direction, rawPayload: rawPunch };

    try {
      const outcome = await runTransaction(db, async tx => {
        const events = [];
        const previous = await tx.biometricPunchLog.findUnique({ where: { biometricId_punchTime_deviceId: key } });
        if (previous && ["PROCESSED", "IGNORED_DUPLICATE"].includes(previous.status)) {
          return { result: { success: true, status: "IGNORED_DUPLICATE", biometricId, punchTime }, events };
        }
        if (!user) {
          await tx.biometricPunchLog.upsert({
            where: { biometricId_punchTime_deviceId: key },
            create: { ...data, status: "UNMAPPED_USER" }, update: { status: "UNMAPPED_USER" },
          });
          return { result: { success: true, status: "UNMAPPED_USER", biometricId }, events };
        }
        // Reuse old ERROR / IN_PROGRESS reservations. New reservations and attendance
        // mutations commit together, so a crash cannot leave half a punch applied.
        const punchLog = await tx.biometricPunchLog.upsert({
          where: { biometricId_punchTime_deviceId: key },
          create: { ...data, status: "IN_PROGRESS" },
          update: { ...data, status: "IN_PROGRESS" },
        });
        const recent = await tx.biometricPunchLog.findFirst({
          where: {
            biometricId, status: "PROCESSED",
            punchTime: { gte: new Date(punchTime.getTime() - 60000), lte: new Date(punchTime.getTime() + 60000) },
          },
        });
        if (recent) {
          await tx.biometricPunchLog.update({ where: { id: punchLog.id }, data: { status: "IGNORED_DUPLICATE", message: "Duplicate punch within 60s window" } });
          return { result: { success: true, status: "IGNORED_DUPLICATE", biometricId, punchTime }, events };
        }
        // Recover reservations left by older versions that committed attendance
        // separately from the log, without toggling AUTO a second time.
        const applied = previous && await tx.attendanceSession.findFirst({
          where: { attendance: { userId: user.id }, OR: [{ checkIn: punchTime }, { checkOut: punchTime }] },
        });
        let actionTaken;
        if (applied) {
          actionTaken = "ALREADY_APPLIED";
        } else {
          const cfg = await attendanceService.getConfig(tx);
          const active = await tx.attendance.findFirst({
            where: {
              userId: user.id,
              OR: [
                { sessions: { some: { checkOut: null, checkIn: { lte: punchTime } } } },
                { sessions: { none: {} }, checkOut: null, checkIn: { not: null, lte: punchTime } },
              ],
            },
            include: { sessions: true },
          });
          const activeCheckIn = active?.sessions.find(s => !s.checkOut)?.checkIn || active?.checkIn;
          const recentActive = activeCheckIn && punchTime - activeCheckIn <= cfg.autoCheckoutHours * 3600000;
          const options = { timezone: user.timezone || "UTC", punchTime, notes: `Matrix Punch (${deviceId})` };
          if (direction === "OUT" || (direction === "AUTO" && active)) {
            if (recentActive) {
              await attendanceService.checkOut(user.id, options, tx, events);
              actionTaken = "CHECK_OUT";
            } else if (active) {
              throw new Error("Active session exceeds checkout window; retry after automatic checkout");
            } else {
              actionTaken = "NO_OPEN_SESSION";
            }
          } else if (active && recentActive) {
            actionTaken = "SESSION_ALREADY_OPEN";
          } else if (active) {
            throw new Error("Active session exceeds checkout window; retry after automatic checkout");
          } else {
            await attendanceService.checkIn(user.id, { ...options, trustedSource: "MATRIX" }, tx, events);
            actionTaken = "CHECK_IN";
          }
        }
        await tx.biometricPunchLog.update({ where: { id: punchLog.id }, data: { status: "PROCESSED", message: actionTaken } });
        return { result: { success: true, status: "PROCESSED", actionTaken, userId: user.id, userName: user.name, punchLogId: punchLog.id }, events };
      });
      // Only publish events after a successful commit, including after transaction retries.
      for (const event of outcome.events) emitToAdmins(event.event, event.payload);
      if (outcome.result.status === "PROCESSED") {
        emitToAdmins("attendance:biometric_punch", { ...outcome.result, biometricId, direction, deviceId, punchTime, department: user.department });
        emitToUser(user.id, "attendance:biometric_punch", { actionTaken: outcome.result.actionTaken, punchTime });
      }
      return outcome.result;
    } catch (err) {
      console.error("[MatrixBiometric] Error processing punch:", err);
      // Preserve completed logs if another delivery committed concurrently.
      try {
        await db.biometricPunchLog.create({ data: { ...data, status: "ERROR", message: err.message } });
      } catch (logError) {
        if (logError.code !== "P2002") console.error("[MatrixBiometric] Failed to log punch error:", logError);
      }
      return { success: false, status: "ERROR", message: err.message, userId: user?.id, biometricId };
    }
  },

  /**
   * Processes a batch of biometric punches in order, collecting summary counts and results.
   * If an earlier punch for an employee fails with a transient ERROR, subsequent punches
   * for that employee in the batch are deferred to preserve chronological ordering.
   *
   * @param {object|object[]|{events: object[]}} payload - Batch webhook payload of punch events
   * @returns {Promise<object>} Processing summary including success status and per-punch results
   */
  async processPayload(payload) {
    const events = Array.isArray(payload) ? payload : Array.isArray(payload?.events) ? payload.events : payload ? [payload] : [];
    const results = [];
    const blockedIds = new Set();
    for (const event of events) {
      const id = String(event?.UserID ?? event?.userId ?? event?.biometricId ?? event?.EnrollmentID ?? event?.badgeId ?? "").trim();
      if (id && blockedIds.has(id)) {
        results.push({
          success: false,
          status: "ERROR",
          message: "Earlier punch for this employee failed; retry in order",
          biometricId: id,
        });
        continue;
      }
      try {
        const result = await this.processSinglePunch(event);
        results.push(result);
        if (result.status === "ERROR" && id) blockedIds.add(id);
      } catch (err) {
        results.push({ success: false, status: "ERROR", message: err.message, ...(id ? { biometricId: id } : {}) });
        if (id) blockedIds.add(id);
      }
    }
    return {
      success: results.every(r => r.success), count: results.length,
      processed: results.filter(r => r.status === "PROCESSED").length,
      duplicates: results.filter(r => r.status === "IGNORED_DUPLICATE").length,
      unmapped: results.filter(r => r.status === "UNMAPPED_USER").length,
      failed: results.filter(r => !r.success).length, results,
    };
  },
};

module.exports = { matrixBiometricService, parseMatrixTimestamp };
