import assert from "node:assert/strict";
import test from "node:test";

import {
  repairStaleCodexAuthBinding,
  repairStaleOpenAiAuthOrder,
} from "../scripts/repair-stale-auth-order.mjs";

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

test("removes only stale openai:default from a Codex thread binding", () => {
  const value = {
    version: 1,
    state: "bound",
    binding: {
      threadId: "thread-1",
      authProfileId: "openai:default",
      model: "gpt-5.6-sol",
    },
    sessionId: "session-1",
  };

  assert.equal(repairStaleCodexAuthBinding(value), true);
  assert.deepEqual(value, {
    version: 1,
    state: "bound",
    binding: { threadId: "thread-1", model: "gpt-5.6-sol" },
    sessionId: "session-1",
  });
});

test("preserves a real Codex auth profile binding", () => {
  const value = { binding: { authProfileId: "openai:work" } };

  assert.equal(repairStaleCodexAuthBinding(value), false);
  assert.deepEqual(value, { binding: { authProfileId: "openai:work" } });
});
