import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const entrypoint = new URL("../scripts/docker-entrypoint.sh", import.meta.url).pathname;

function writeFakeOpenClaw(packageDir, generation) {
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(path.join(packageDir, "generation"), `${generation}\n`);
  fs.writeFileSync(
    path.join(packageDir, "openclaw.mjs"),
    `import fs from "node:fs";
import path from "node:path";
if (process.argv.includes("--version")) {
  console.log("OpenClaw fake");
} else if (process.argv.includes("plugins") && process.argv.includes("install")) {
  const state = process.env.OPENCLAW_STATE_DIR;
  const target = path.join(state, "extensions", "codex");
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "openclaw.plugin.json"), "{}\\n");
  const countPath = path.join(state, "codex-install-count");
  const count = Number(fs.existsSync(countPath) ? fs.readFileSync(countPath, "utf8") : "0");
  fs.writeFileSync(countPath, String(count + 1));
} else {
  process.exitCode = 2;
}
`,
  );
}

test("entrypoint atomically adopts a new core and Codex seed once", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-entrypoint-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const seedRoot = path.join(root, "seed");
  const runtimeRoot = path.join(root, "runtime");
  const stateDir = path.join(root, "state");
  const seedPackage = path.join(seedRoot, "lib", "node_modules", "openclaw");
  const runtimePackage = path.join(runtimeRoot, "lib", "node_modules", "openclaw");
  const codexTarball = path.join(root, "codex.tgz");
  const seedId = "openclaw@2026.7.1-2+fixture";

  writeFakeOpenClaw(seedPackage, "new");
  writeFakeOpenClaw(runtimePackage, "old");
  fs.writeFileSync(path.join(seedRoot, ".openclaw-seed-id"), `${seedId}\n`);
  fs.writeFileSync(codexTarball, "fixture");

  const env = {
    ...process.env,
    HOME: root,
    NPM_CONFIG_PREFIX: runtimeRoot,
    OPENCLAW_CODEX_SEED_TARBALL: codexTarball,
    OPENCLAW_SEED_ROOT: seedRoot,
    OPENCLAW_STATE_DIR: stateDir,
  };
  const first = spawnSync("bash", [entrypoint, "true"], { encoding: "utf8", env });
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.equal(fs.readFileSync(path.join(runtimePackage, "generation"), "utf8"), "new\n");
  assert.equal(fs.readFileSync(path.join(runtimeRoot, ".openclaw-seed-id"), "utf8"), `${seedId}\n`);
  assert.equal(fs.readFileSync(path.join(runtimeRoot, ".openclaw-codex-seed-id"), "utf8"), `${seedId}\n`);
  assert.equal(fs.readFileSync(path.join(stateDir, "codex-install-count"), "utf8"), "1");
  assert.deepEqual(
    fs.readdirSync(path.join(runtimeRoot, "lib", "node_modules")).filter((name) =>
      name.startsWith("openclaw.previous-"),
    ),
    [],
  );

  const second = spawnSync("bash", [entrypoint, "true"], { encoding: "utf8", env });
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(fs.readFileSync(path.join(stateDir, "codex-install-count"), "utf8"), "1");
});
