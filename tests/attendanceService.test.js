const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/services/attendanceService.js"), "utf8");
const cfg = { autoCheckoutHours: 10, halfDayHours: 4, workStartHour: 9, workStartMinute: 0, lateThresholdMin: 0 };
class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

function matches(record, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some(filter => matches(record, filter));
    if (key === "sessions") {
      if (value.some) return record.sessions.some(session => matches(session, value.some));
      if (value.none) return !record.sessions.some(session => matches(session, value.none));
    }
    if (value && typeof value === "object") {
      if (value.not !== undefined && record[key] === value.not) return false;
      return (value.gte === undefined || record[key] >= value.gte)
        && (value.lte === undefined || record[key] <= value.lte);
    }
    return record[key] === value;
  });
}

function setup(record, { today = false } = {}) {
  const calls = { created: [], updated: [], parents: [] };
  const sessions = record?.sessions || [];
  const db = {
    attendanceConfig: { findFirst: async () => cfg },
    officeLocation: { findMany: async () => [] },
    user: { findFirst: async () => ({ id: 7 }) },
    attendance: {
      findUnique: async () => today ? record : null,
      findFirst: async ({ where }) => record && matches(record, where) ? record : null,
      update: async ({ data }) => {
        calls.parents.push(data);
        return { ...record, ...data, sessions, user: { name: "Employee" } };
      },
      create: async ({ data }) => ({ ...data, sessions: [{ id: 10, ...data.sessions.create }], user: { name: "Employee" } }),
    },
    attendanceSession: {
      create: async ({ data }) => {
        const session = { id: sessions.length + 1, ...data };
        calls.created.push(session);
        sessions.push(session);
        return session;
      },
      update: async ({ where, data }) => {
        calls.updated.push(where.id);
        Object.assign(sessions.find(session => session.id === where.id), data);
      },
      updateMany: async ({ where, data }) => {
        const matching = sessions.filter(session => matches(session, where));
        matching.forEach(session => Object.assign(session, data));
        return { count: matching.length };
      },
      findMany: async () => sessions,
    },
    $transaction: async callback => callback(db),
  };
  const sandbox = {
    module: { exports: {} }, Date, Intl, console,
    require: name => {
      if (name === "../lib/db") return { db };
      if (name === "../lib/auth") return { ApiError };
      if (name === "../lib/socket") return { emitToAdmins() {} };
      if (name === "../lib/geoUtils") return {};
      if (name === "../lib/transaction") return require("../src/lib/transaction");
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.runInNewContext(source, sandbox);
  return { service: sandbox.module.exports.attendanceService, db, calls };
}

function session(id, checkIn, checkOut = null) {
  return { id, checkIn: new Date(checkIn), checkOut: checkOut ? new Date(checkOut) : null, hoursWorked: checkOut ? 4 : null, checkInTz: "UTC" };
}
function attendance(sessions) {
  return { id: 1, userId: 7, checkIn: sessions[0].checkIn, checkOut: null, sessions };
}
const checkout = { timezone: "UTC", punchTime: new Date("2026-10-08T02:00:00Z") };

test("checkout rejects a stale previous-day session without modifying it", async () => {
  const { service, calls } = setup(attendance([session(1, "2026-10-06T09:00:00Z")]));
  await assert.rejects(service.checkOut(7, checkout), error => error.status === 404);
  assert.equal(calls.updated.length, 0);
  assert.equal(calls.created.length, 0);
});

test("checkout accepts a recent overnight session and totals its hours", async () => {
  const { service } = setup(attendance([session(1, "2026-10-07T22:00:00Z")]));
  const result = await service.checkOut(7, checkout);
  assert.equal(result.hoursWorked, 4);
  assert.equal(result.checkOut, checkout.punchTime);
});

test("checkout uses the resumed session age instead of the first check-in", async () => {
  const { service } = setup(attendance([
    session(1, "2026-10-07T08:00:00Z", "2026-10-07T12:00:00Z"),
    session(2, "2026-10-07T22:00:00Z"),
  ]));
  const result = await service.checkOut(7, checkout);
  assert.equal(result.hoursWorked, 8);
});

test("checkout does not match future check-ins", async () => {
  const { service } = setup(attendance([session(1, "2026-10-08T03:00:00Z")]));
  await assert.rejects(service.checkOut(7, checkout), error => error.status === 404);
});

test("checkout recovers a recent sessionless legacy record", async () => {
  const record = { id: 1, userId: 7, checkIn: new Date("2026-10-07T22:00:00Z"), checkOut: null, sessions: [] };
  const { service, calls } = setup(record);
  const result = await service.checkOut(7, checkout);
  assert.equal(calls.created.length, 1);
  assert.equal(result.hoursWorked, 4);
});

test("checkout does not recreate closed sessions when the parent is inconsistent", async () => {
  const { service, calls } = setup(attendance([session(1, "2026-10-08T00:00:00Z", "2026-10-08T01:00:00Z")]), { today: true });
  await assert.rejects(service.checkOut(7, checkout), error => error.code === "DUPLICATE_CHECKOUT");
  assert.equal(calls.created.length, 0);
});

const manual = { userId: 7, date: "2026-10-08", checkInTime: "14:00", checkOutTime: "18:00", timezone: "UTC" };
test("manual entry preserves a sole closed session when adding a missed shift", async () => {
  const original = session(1, "2026-10-08T09:00:00Z", "2026-10-08T13:00:00Z");
  const { service, calls, db } = setup(attendance([original]), { today: true });
  const result = await service.recordManual(manual, db);
  assert.equal(calls.created.length, 1);
  assert.equal(calls.updated.length, 0);
  assert.equal(original.checkIn.toISOString(), "2026-10-08T09:00:00.000Z");
  assert.equal(result.hoursWorked, 8);
});

test("manual entry updates a matching sole session", async () => {
  const { service, calls, db } = setup(attendance([session(1, "2026-10-08T14:00:00Z")]), { today: true });
  await service.recordManual(manual, db);
  assert.deepEqual(calls.updated, [1]);
  assert.equal(calls.created.length, 0);
});

test("manual open edit reuses the existing open session", async () => {
  const { service, calls, db } = setup(attendance([session(1, "2026-10-08T09:00:00Z")]), { today: true });
  await service.recordManual({ ...manual, checkOutTime: null }, db);
  assert.deepEqual(calls.updated, [1]);
  assert.equal(calls.created.length, 0);
});

test("check-in rejects an active session from another date", async () => {
  const { service, calls } = setup(attendance([session(1, "2026-10-07T22:00:00Z")]));
  await assert.rejects(service.checkIn(7, { timezone: "UTC", trustedSource: "MATRIX", punchTime: checkout.punchTime }), error => error.code === "DUPLICATE_CHECKIN");
  assert.equal(calls.created.length, 0);
});

test("check-in accepts a new date when earlier sessions are closed", async () => {
  const { service } = setup(attendance([session(1, "2026-10-07T09:00:00Z", "2026-10-07T13:00:00Z")]));
  const result = await service.checkIn(7, { timezone: "UTC", trustedSource: "MATRIX", punchTime: checkout.punchTime });
  assert.equal(result.sessions[0].checkIn, checkout.punchTime);
});

test("auto-checkout closes a previous-day session and totals all sessions", async () => {
  const old = new Date(Date.now() - 48 * 3600000).toISOString();
  const rec = attendance([session(1, old, new Date(Date.now() - 44 * 3600000).toISOString()), session(2, old)]);
  const { service, db, calls } = setup(rec);
  let reads = 0;
  db.attendanceSession.findMany = async () => ++reads === 1 ? [{ ...rec.sessions[1], attendanceId: 1, attendance: { date: old } }] : rec.sessions;
  assert.equal(await service.autoCheckoutOverdue(), 1);
  assert.equal(calls.parents[0].hoursWorked, 14);
  assert.equal(rec.sessions[1].checkOut.getTime(), new Date(old).getTime() + 10 * 3600000);
});

test("auto-checkout does not overwrite a session closed after the scan", async () => {
  const rec = attendance([session(1, new Date(Date.now() - 48 * 3600000).toISOString())]);
  const { service, db, calls } = setup(rec);
  db.attendanceSession.findMany = async () => [{ ...rec.sessions[0], attendanceId: 1, attendance: {} }];
  db.attendanceSession.updateMany = async () => ({ count: 0 });
  assert.equal(await service.autoCheckoutOverdue(), 0);
  assert.equal(calls.parents.length, 0);
});
