const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { runTransaction } = require("../src/lib/transaction");
const attendanceSource = fs.readFileSync(path.join(__dirname, "../src/services/attendanceService.js"), "utf8");
const attendanceBox = { module: { exports: {} }, Date, Intl, require: () => ({}) };
vm.runInNewContext(attendanceSource, attendanceBox);
const { zonedDateTimeToUtc } = attendanceBox.module.exports;
const source = fs.readFileSync(path.join(__dirname, "../src/services/matrixBiometricService.js"), "utf8");
const event = { UserID: "7", EventTime: "2026-10-08T04:00:00Z", Direction: "IN", DeviceID: "A" };

function setup({ active = null, failLogOnce = false, conflictOnce = false, logs = [] } = {}) {
  let state = { logs: structuredClone(logs), active, sessions: [], actions: [] };
  let fail = failLogOnce;
  let conflict = conflictOnce;
  let mapped = true;
  const emitted = [];
  const matchesKey = (log, key) => log.biometricId === key.biometricId && +log.punchTime === +key.punchTime && log.deviceId === key.deviceId;
  const punches = {
    findUnique: async ({ where }) => state.logs.find(log => matchesKey(log, where.biometricId_punchTime_deviceId)),
    findFirst: async ({ where }) => state.logs.find(log => log.biometricId === where.biometricId && log.status === where.status && log.punchTime >= where.punchTime.gte && log.punchTime <= where.punchTime.lte),
    create: async ({ data }) => {
      if (state.logs.some(log => matchesKey(log, data))) throw Object.assign(new Error("unique"), { code: "P2002" });
      const log = { id: state.logs.length + 1, ...data };
      state.logs.push(log);
      return log;
    },
    upsert: async ({ where, create, update }) => {
      const previous = await punches.findUnique({ where });
      return previous ? Object.assign(previous, update) : punches.create({ data: create });
    },
    update: async ({ where, data }) => {
      if (data.status === "PROCESSED" && fail) { fail = false; throw new Error("temporary log failure"); }
      return Object.assign(state.logs.find(log => log.id === where.id), data);
    },
  };
  const tx = {
    biometricPunchLog: punches,
    user: { findFirst: async () => mapped ? { id: 7, name: "Employee", timezone: "Asia/Kolkata" } : null },
    attendance: { findFirst: async () => state.active },
    attendanceSession: { findFirst: async () => state.sessions[0] || null },
  };
  const db = { ...tx, $transaction: async callback => {
    const snapshot = structuredClone(state);
    try {
      const result = await callback(tx);
      if (conflict) { conflict = false; throw Object.assign(new Error("serialization conflict"), { code: "P2034" }); }
      return result;
    } catch (err) { state = snapshot; throw err; }
  } };
  const service = {
    getConfig: async () => ({ autoCheckoutHours: 10 }),
    checkIn: async (id, options, client, events) => {
      assert.equal(client, tx);
      state.actions.push("IN");
      state.sessions.push({ checkIn: options.punchTime });
      state.active = { checkIn: options.punchTime, sessions: [{ checkIn: options.punchTime, checkOut: null }] };
      events.push({ event: "attendance:checkin", payload: { userId: id } });
    },
    checkOut: async (id, options, client, events) => {
      assert.equal(client, tx);
      state.actions.push("OUT"); state.active = null;
      events.push({ event: "attendance:checkout", payload: { userId: id } });
    },
  };
  const box = {
    module: { exports: {} }, Date, Intl, Buffer, console: { error() {} }, process: { env: {} },
    require: name => {
      if (name === "crypto") return require(name);
      if (name === "../lib/db") return { db };
      if (name === "../lib/transaction") return { runTransaction };
      if (name === "./attendanceService") return { attendanceService: service, zonedDateTimeToUtc };
      return { emitToAdmins: (name, payload) => emitted.push({ name, payload }), emitToUser() {} };
    },
  };
  vm.runInNewContext(source, box);
  return { ...box.module.exports, get state() { return state; }, emitted, env: box.process.env, setMapped(value) { mapped = value; } };
}

test("scanner local timestamps resolve using an explicit IANA zone and preserve seconds", () => {
  const { parseMatrixTimestamp } = setup();
  assert.equal(parseMatrixTimestamp("2026-10-08 09:30:22", "Asia/Kolkata").toISOString(), "2026-10-08T04:00:22.000Z");
  assert.equal(parseMatrixTimestamp("08-10-2026 09:30:22", "Asia/Kolkata").toISOString(), "2026-10-08T04:00:22.000Z");
  assert.equal(parseMatrixTimestamp("2026/10/08 09:30:22.123", "Asia/Kolkata").toISOString(), "2026-10-08T04:00:22.123Z");
  assert.equal(parseMatrixTimestamp("2026-10-08T09:30:22+05:30", "America/New_York").toISOString(), "2026-10-08T04:00:22.000Z");
  assert.equal(parseMatrixTimestamp("2026-10-08 09:30:22+05:30", "UTC").toISOString(), "2026-10-08T04:00:22.000Z");
  assert.equal(parseMatrixTimestamp("2026-10-08 00:00:00", "UTC").toISOString(), "2026-10-08T00:00:00.000Z");
  assert.equal(parseMatrixTimestamp("2026-02-30 09:30:00", "UTC"), null);
  assert.equal(parseMatrixTimestamp("2026-10-08 25:30:00", "UTC"), null);
  assert.equal(parseMatrixTimestamp("2026-10-08 09:30:00", "Invalid/Zone"), null);
});

test("zone-free punches use the employee timezone, with a scanner override", async () => {
  const a = setup();
  await a.matrixBiometricService.processSinglePunch({ ...event, EventTime: "2026-10-08 09:30:00" });
  assert.equal(a.state.logs[0].punchTime.toISOString(), "2026-10-08T04:00:00.000Z");
  const b = setup(); b.env.MATRIX_TIMEZONE = "UTC";
  await b.matrixBiometricService.processSinglePunch({ ...event, EventTime: "2026-10-08 09:30:00" });
  assert.equal(b.state.logs[0].punchTime.toISOString(), "2026-10-08T09:30:00.000Z");
});

test("exact replay and nearby scans are accepted without mutating attendance twice", async () => {
  const a = setup();
  assert.equal((await a.matrixBiometricService.processSinglePunch(event)).status, "PROCESSED");
  assert.equal((await a.matrixBiometricService.processSinglePunch(event)).status, "IGNORED_DUPLICATE");
  assert.equal((await a.matrixBiometricService.processSinglePunch({ ...event, EventTime: "2026-10-08T04:00:30Z" })).status, "IGNORED_DUPLICATE");
  assert.deepEqual(a.state.actions, ["IN"]);
  assert.equal(a.state.logs.length, 2);
});

test("failure after attendance mutation rolls it back and retry succeeds", async () => {
  const a = setup({ failLogOnce: true });
  assert.equal((await a.matrixBiometricService.processSinglePunch(event)).status, "ERROR");
  assert.equal(a.state.actions.length, 0);
  assert.equal(a.emitted.length, 0);
  assert.equal((await a.matrixBiometricService.processSinglePunch(event)).status, "PROCESSED");
  assert.deepEqual(a.state.actions, ["IN"]);
  assert.equal(a.state.logs[0].status, "PROCESSED");
});

test("abandoned IN_PROGRESS reservations can be recovered", async () => {
  const a = setup({ logs: [{ id: 1, biometricId: "7", punchTime: new Date(event.EventTime), deviceId: "A", status: "IN_PROGRESS" }] });
  assert.equal((await a.matrixBiometricService.processSinglePunch(event)).actionTaken, "CHECK_IN");
  assert.equal(a.state.logs.length, 1);
});

test("legacy partially applied AUTO does not toggle again", async () => {
  const a = setup({ logs: [{ id: 1, biometricId: "7", punchTime: new Date(event.EventTime), deviceId: "A", status: "ERROR" }] });
  a.state.sessions.push({ checkIn: new Date(event.EventTime) });
  assert.equal((await a.matrixBiometricService.processSinglePunch({ ...event, Direction: "AUTO" })).actionTaken, "ALREADY_APPLIED");
  assert.equal(a.state.actions.length, 0);
});

for (const direction of ["OUT", "AUTO"]) {
  test(`${direction} closes an overnight session`, async () => {
    const checkIn = new Date("2026-10-07T22:00:00Z");
    const a = setup({ active: { checkIn, sessions: [{ checkIn, checkOut: null }] } });
    assert.equal((await a.matrixBiometricService.processSinglePunch({ ...event, Direction: direction })).actionTaken, "CHECK_OUT");
    assert.deepEqual(a.state.actions, ["OUT"]);
  });
}

test("serialization retry publishes attendance only once after commit", async () => {
  const a = setup({ conflictOnce: true });
  assert.equal((await a.matrixBiometricService.processSinglePunch(event)).status, "PROCESSED");
  assert.deepEqual(a.state.actions, ["IN"]);
  assert.equal(a.emitted.filter(e => e.name === "attendance:checkin").length, 1);
});

test("batch failure blocks later punches for the same employee until retry", async () => {
  const a = setup({ failLogOnce: true });
  const punches = [event, { ...event, EventTime: "2026-10-08T12:00:00Z", Direction: "OUT" }];
  const failed = await a.matrixBiometricService.processPayload(punches);
  assert.equal(failed.success, false);
  assert.equal(failed.failed, 2);
  assert.equal(failed.results[1].biometricId, "7");
  assert.equal(a.state.actions.length, 0);
  const retried = await a.matrixBiometricService.processPayload(punches);
  assert.equal(retried.success, true);
  assert.deepEqual(a.state.actions, ["IN", "OUT"]);
});

test("IN throws and fails when open session exceeds autoCheckoutHours", async () => {
  const checkIn = new Date("2026-10-07T12:00:00Z"); // 16h earlier, exceeding autoCheckoutHours (10)
  const a = setup({ active: { checkIn, sessions: [{ checkIn, checkOut: null }] } });
  const res = await a.matrixBiometricService.processSinglePunch(event);
  assert.equal(res.status, "ERROR");
  assert.match(res.message, /Active session exceeds checkout window/);
  assert.equal(a.state.actions.length, 0);
});

test("INVALID_PAYLOAD does not block subsequent valid punches for the same employee", async () => {
  const a = setup();
  const invalidPunch = { ...event, EventTime: "invalid-time" };
  const validPunch = { ...event, EventTime: "2026-10-08T04:00:00Z" };
  const res = await a.matrixBiometricService.processPayload([invalidPunch, validPunch]);
  assert.equal(res.success, false);
  assert.equal(res.results[0].status, "INVALID_PAYLOAD");
  assert.equal(res.results[1].status, "PROCESSED");
  assert.deepEqual(a.state.actions, ["IN"]);
});
