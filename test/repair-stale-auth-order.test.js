import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  repairCodexBindings,
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

test("repairs persisted Codex bindings using the stable plugin-state schema", async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), "openclaw-auth-repair-"));
  await mkdir(path.join(stateDir, "state"));
  const databasePath = path.join(stateDir, "state", "openclaw.sqlite");
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`CREATE TABLE plugin_state_entries (
      plugin_id TEXT NOT NULL,
      namespace TEXT NOT NULL,
      entry_key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      PRIMARY KEY (plugin_id, namespace, entry_key)
    ) STRICT`);
    const stale = JSON.stringify({
      binding: { threadId: "thread-1", authProfileId: "openai:default" },
    });
    database
      .prepare("INSERT INTO plugin_state_entries VALUES (?, ?, ?, ?, ?, ?)")
      .run("codex", "app-server-thread-bindings", "binding-1", stale, Date.now(), null);
  } finally {
    database.close();
  }

  try {
    assert.equal(await repairCodexBindings(stateDir, { auth: { profiles: {} } }), 1);
    const verification = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const row = verification
        .prepare("SELECT value_json FROM plugin_state_entries WHERE entry_key = ?")
        .get("binding-1");
      assert.deepEqual(JSON.parse(row.value_json), { binding: { threadId: "thread-1" } });
    } finally {
      verification.close();
    }
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
