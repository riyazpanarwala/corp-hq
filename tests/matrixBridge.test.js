const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../scripts/matrix-bridge.js"), "utf8");

function setup(responses) {
  let content = "UserID,EventDate,EventTime,Direction,DeviceID";
  let tick;
  const sent = [];
  const sandbox = {
    module: { exports: {} },
    require: name => name === "fs" ? { existsSync: () => true, readFileSync: () => content } : {},
    process: { env: { MATRIX_WEBHOOK_SECRET: "test" }, argv: [] },
    console: { log() {}, error() {}, warn() {} },
    setInterval: callback => { tick = callback; },
    fetch: async (url, options) => {
      sent.push(JSON.parse(options.body));
      const response = responses.shift();
      return { ok: response.ok ?? true, status: response.status ?? 200, json: async () => response.body };
    },
  };
  vm.runInNewContext(source, sandbox);
  return { ...sandbox.module.exports, sent, append: line => { content += `\n${line}`; }, tick: async () => tick() };
}

test("HTTP 200 with a failed punch does not count as bridge success", async () => {
  const a = setup([{ body: { success: true, results: [{ success: false, status: "ERROR" }] } }]);
  assert.equal(await a.sendPunchesToCorpHQ([{ UserID: "7" }]), false);
});
test("bridge rejects incomplete responses and accepts acknowledged duplicates", async () => {
  const a = setup([
    { body: { success: true, results: [] } },
    { body: { success: true, results: [{ success: true, status: "IGNORED_DUPLICATE" }] } },
  ]);
  assert.equal(await a.sendPunchesToCorpHQ([{ UserID: "7" }]), false);
  assert.equal(await a.sendPunchesToCorpHQ([{ UserID: "7" }]), true);
});
test("CSV pointer stays before failed punches and advances after acknowledged retry", async () => {
  const a = setup([
    { body: { success: false, results: [{ success: false, status: "ERROR" }] } },
    { body: { success: true, results: [{ success: true, status: "PROCESSED" }] } },
  ]);
  a.runCsvWatcher("punches.csv");
  a.append("7,2026-10-08,09:30:00,IN,A");
  await a.tick(); await a.tick(); await a.tick();
  assert.equal(a.sent.length, 2);
  assert.deepEqual(a.sent[0], a.sent[1]);
});

test("bridge acknowledges permanent rejections like INVALID_PAYLOAD and rejects HTTP 500", async () => {
  const a = setup([
    { status: 422, body: { success: false, results: [{ success: false, status: "INVALID_PAYLOAD" }] } },
    { status: 500, body: { success: false, error: "Internal Server Error" } },
  ]);
  assert.equal(await a.sendPunchesToCorpHQ([{ UserID: "7" }]), true);
  assert.equal(await a.sendPunchesToCorpHQ([{ UserID: "7" }]), false);
});
