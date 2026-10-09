const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/app/api/integrations/matrix/route.js"), "utf8")
  .replace(/^import .*;\r?\n/gm, "").replace(/export async function/g, "async function");

for (const [status, result, expected] of [
  ["PROCESSED", true, 200], ["ERROR", false, 503], ["INVALID_PAYLOAD", false, 422],
]) {
  test(`webhook returns ${expected} for ${status}`, async () => {
    const sandbox = {
      Response, process: { env: {} }, console,
      matrixBiometricService: {
        verifySecret: () => true,
        processPayload: async () => ({ success: result, results: [{ success: result, status }] }),
      },
      MatrixWebhookPayloadSchema: { safeParse: data => ({ success: true, data }) },
    };
    vm.runInNewContext(`${source}\nthis.POST = POST;`, sandbox);
    const response = await sandbox.POST(new Request("https://example.test/api/integrations/matrix", { method: "POST", body: JSON.stringify({ UserID: "7" }) }));
    assert.equal(response.status, expected);
  });
}
