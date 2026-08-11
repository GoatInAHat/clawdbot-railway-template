import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("ws upgrade handler does not enforce Basic auth (browsers can't send headers)", () => {
  const src = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const idx = src.indexOf('server.on("upgrade"');
  assert.ok(idx >= 0);
  const window = src.slice(idx, idx + 700);

  // Regression guard for issue #162: do not destroy browser websocket connections
  // due to missing Authorization: Basic.
  assert.doesNotMatch(window, /WebSocket password protection/);
  assert.doesNotMatch(window, /scheme === "Basic"/);
  assert.doesNotMatch(window, /WWW-Authenticate/);
});

test("voice-call webhook and media paths stay on the loopback voice server", () => {
  const src = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(src, /VOICE_CALL_TARGET = `http:\/\/127\.0\.0\.1:\$\{INTERNAL_VOICE_CALL_PORT\}`/);
  assert.match(src, /pathname\.startsWith\("\/voice\/"\)/);
  assert.match(src, /req\.path\.startsWith\("\/voice\/"\) \? next\(\) : parseJsonBody/);
  assert.match(src, /proxy\.web\(req, res, \{ target: proxyTargetForPath\(req\.path\) \}\)/);
  assert.match(src, /proxy\.ws\(req, socket, head, \{ target: proxyTargetForPath\(pathname\) \}\)/);
});
