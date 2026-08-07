import fs from "node:fs/promises";
import path from "node:path";

export function repairStaleOpenAiAuthOrder(config) {
  const order = config?.auth?.order?.openai;
  if (!Array.isArray(order) || !order.includes("openai:default")) {
    return false;
  }
  if (config.auth?.profiles?.["openai:default"]) {
    return false;
  }
  const remaining = order.filter((profileId) => profileId !== "openai:default");
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
  if (!repairStaleOpenAiAuthOrder(config)) {
    return;
  }
  const temporary = `${configPath}.auth-order-${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, configPath);
  process.stdout.write("[bootstrap] removed stale auth.order.openai profile openai:default\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
