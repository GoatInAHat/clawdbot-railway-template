import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const STALE_PROFILE_ID = "openai:default";

export function repairStaleOpenAiAuthOrder(config) {
  const order = config?.auth?.order?.openai;
  if (!Array.isArray(order) || !order.includes(STALE_PROFILE_ID)) {
    return false;
  }
  if (config.auth?.profiles?.[STALE_PROFILE_ID]) {
    return false;
  }
  const remaining = order.filter((profileId) => profileId !== STALE_PROFILE_ID);
  if (remaining.length > 0) {
    config.auth.order.openai = remaining;
  } else {
    delete config.auth.order.openai;
    if (Object.keys(config.auth.order).length === 0) {
      delete config.auth.order;
    }
  }
  return true;
}

export function repairStaleCodexAuthBinding(value) {
  if (value?.binding?.authProfileId !== STALE_PROFILE_ID) {
    return false;
  }
  delete value.binding.authProfileId;
  return true;
}

export async function repairCodexBindings(stateDir, config) {
  if (config.auth?.profiles?.[STALE_PROFILE_ID]) {
    return 0;
  }
  const databasePath = path.join(stateDir, "state", "openclaw.sqlite");
  try {
    await fs.access(databasePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
  const database = new DatabaseSync(databasePath);
  try {
    const rows = database
      .prepare(
        `SELECT entry_key, value_json
           FROM plugin_state_entries
          WHERE plugin_id = 'codex'
            AND namespace = 'app-server-thread-bindings'
            AND instr(value_json, ?) > 0`,
      )
      .all(STALE_PROFILE_ID);
    const update = database.prepare(
      `UPDATE plugin_state_entries
          SET value_json = ?
        WHERE plugin_id = 'codex'
          AND namespace = 'app-server-thread-bindings'
          AND entry_key = ?
          AND value_json = ?`,
    );
    let repaired = 0;
    database.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        const value = JSON.parse(row.value_json);
        if (!repairStaleCodexAuthBinding(value)) {
          continue;
        }
        repaired += Number(
          update.run(JSON.stringify(value), row.entry_key, row.value_json).changes,
        );
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return repaired;
  } finally {
    database.close();
  }
}

async function main() {
  const stateDir = process.argv[2];
  if (!stateDir) {
    throw new Error("state directory is required");
  }
  const configPath = path.join(stateDir, "openclaw.json");
  let raw;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }
  const config = JSON.parse(raw);
  const repairedOrder = repairStaleOpenAiAuthOrder(config);
  if (repairedOrder) {
    const temporary = `${configPath}.auth-order-${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, configPath);
    process.stdout.write("[bootstrap] removed stale auth.order.openai profile openai:default\n");
  }
  const repairedBindings = await repairCodexBindings(stateDir, config);
  if (repairedBindings > 0) {
    process.stdout.write(
      `[bootstrap] removed stale openai:default auth profile from ${repairedBindings} Codex bindings\n`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
