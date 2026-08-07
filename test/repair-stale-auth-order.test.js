import assert from "node:assert/strict";
import test from "node:test";

import { repairStaleOpenAiAuthOrder } from "../scripts/repair-stale-auth-order.mjs";

test("removes only a missing openai:default auth order entry", () => {
  const config = {
    auth: {
      profiles: {},
      order: { openai: ["openai:default", "openai:work"], anthropic: ["anthropic:work"] },
    },
  };

  assert.equal(repairStaleOpenAiAuthOrder(config), true);
  assert.deepEqual(config.auth.order, {
    openai: ["openai:work"],
    anthropic: ["anthropic:work"],
  });
});

test("preserves openai:default when its profile exists", () => {
  const config = {
    auth: {
      profiles: { "openai:default": { provider: "openai", mode: "api_key" } },
      order: { openai: ["openai:default"] },
    },
  };

  assert.equal(repairStaleOpenAiAuthOrder(config), false);
  assert.deepEqual(config.auth.order.openai, ["openai:default"]);
});
