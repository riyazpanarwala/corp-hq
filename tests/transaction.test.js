const assert = require("node:assert/strict");
const test = require("node:test");
const { runTransaction } = require("../src/lib/transaction");

test("concurrent transaction conflicts are retried with serializable isolation", async () => {
  let attempts = 0;
  const client = { $transaction: async (fn, options) => {
    assert.equal(options.isolationLevel, "Serializable");
    if (++attempts < 3) throw Object.assign(new Error("conflict"), { code: "P2034" });
    return fn({});
  } };
  assert.equal(await runTransaction(client, async () => "committed"), "committed");
  assert.equal(attempts, 3);
});
test("an enclosing transaction is reused without a nested commit", async () => {
  const tx = {};
  assert.equal(await runTransaction(tx, async client => client), tx);
});
