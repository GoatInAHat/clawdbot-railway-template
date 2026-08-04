import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("the public wrapper leaves dashboard and plugin authentication to OpenClaw", () => {
  assert.doesNotMatch(source, /function requireDashboardAuth/);
  assert.doesNotMatch(source, /OpenClaw Dashboard/);
  assert.doesNotMatch(source, /function attachGatewayAuthHeader/);
  assert.doesNotMatch(source, /req\.headers\.authorization = `Bearer/);
});
