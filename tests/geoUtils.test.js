const assert = require("node:assert/strict");
const test = require("node:test");
const { extractClientIp } = require("../src/lib/geoUtils");

function withEnv(env, fn) {
  const names = ["NODE_ENV", "TRUST_PROXY", "CLIENT_IP_HEADER", "PROXY_HOPS"];
  const original = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    names.forEach(name => { delete process.env[name]; });
    Object.assign(process.env, env);
    fn();
  } finally {
    names.forEach(name => { if (original[name] === undefined) delete process.env[name]; else process.env[name] = original[name]; });
  }
}
const request = headers => new Request("https://example.test", { headers });

test("production does not implicitly trust any client IP headers", () => {
  withEnv({ NODE_ENV: "production", TRUST_PROXY: "false" }, () => {
    assert.equal(extractClientIp(request({ "cf-connecting-ip": "203.0.113.1", "x-real-ip": "203.0.113.1", "x-forwarded-for": "203.0.113.1" })), null);
  });
});
test("trusted XFF uses configured hop and ignores forged higher-priority headers", () => {
  withEnv({ TRUST_PROXY: "true", PROXY_HOPS: "2" }, () => {
    assert.equal(extractClientIp(request({ "cf-connecting-ip": "203.0.113.1", "x-real-ip": "203.0.113.1", "x-forwarded-for": "192.0.2.1, 198.51.100.2, 10.0.0.1" })), "198.51.100.2");
    assert.equal(extractClientIp(request({ "x-forwarded-for": "198.51.100.2" })), null);
  });
});
test("explicit trusted header validates IP syntax and mapped IPv4", () => {
  withEnv({ TRUST_PROXY: "true", CLIENT_IP_HEADER: "cf-connecting-ip" }, () => {
    assert.equal(extractClientIp(request({ "cf-connecting-ip": "::ffff:203.0.113.1" })), "203.0.113.1");
    assert.equal(extractClientIp(request({ "cf-connecting-ip": "203.0.113.1, 10.0.0.1" })), null);
  });
});
test("missing client IP never falls back to an allowlisted localhost", () => {
  withEnv({ NODE_ENV: "development" }, () => assert.equal(extractClientIp(request({})), null));
});
