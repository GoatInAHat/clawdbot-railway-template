import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("carrier voice paths bypass dashboard auth and proxy to the voice runtime", () => {
  const voiceRoute = source.indexOf("if (!isVoiceCallPath(req)) return next()");
  const dashboardRoute = source.indexOf("app.use(requireDashboardAuth");

  assert.ok(voiceRoute >= 0, "voice HTTP proxy route is missing");
  assert.ok(dashboardRoute >= 0, "dashboard route is missing");
  assert.ok(voiceRoute < dashboardRoute, "voice proxy must run before dashboard auth");
  assert.match(source, /voiceCallProxy\.web\(req, res/);
});

test("voice media websocket upgrades use the voice runtime", () => {
  const upgradeHandler = source.indexOf('server.on("upgrade"');
  assert.ok(upgradeHandler >= 0, "websocket upgrade handler is missing");

  const upgradeSource = source.slice(upgradeHandler, upgradeHandler + 900);
  assert.match(upgradeSource, /if \(isVoiceCallPath\(req\)\)/);
  assert.match(upgradeSource, /voiceCallProxy\.ws\(req, socket, head/);
});
