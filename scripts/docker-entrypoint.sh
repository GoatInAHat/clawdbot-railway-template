#!/usr/bin/env bash
set -euo pipefail

seed_root=${OPENCLAW_SEED_ROOT:-/opt/openclaw-seed}
runtime_root=${NPM_CONFIG_PREFIX:-/data/npm}
runtime_package="$runtime_root/lib/node_modules/openclaw"
runtime_entry="$runtime_package/openclaw.mjs"
seed_package="$seed_root/lib/node_modules/openclaw"
seed_entry="$seed_package/openclaw.mjs"
seed_id_file="$seed_root/.openclaw-seed-id"
runtime_id_file="$runtime_root/.openclaw-seed-id"
codex_seed=${OPENCLAW_CODEX_SEED_TARBALL:-/opt/openclaw-codex.tgz}
discord_seed=${OPENCLAW_DISCORD_SEED_TARBALL:-/opt/openclaw-discord.tgz}
tencent_patch=${OPENCLAW_TENCENT_PATCH_SCRIPT:-/usr/local/lib/openclaw/patch-memory-tencentdb.mjs}
auth_order_repair=${OPENCLAW_AUTH_ORDER_REPAIR_SCRIPT:-/usr/local/lib/openclaw/repair-stale-auth-order.mjs}
state_dir=${OPENCLAW_STATE_DIR:-${HOME}/.openclaw}

if [[ "$runtime_root" != /* || "$runtime_root" == / ]]; then
  echo "[bootstrap] refusing unsafe package prefix: $runtime_root" >&2
  exit 1
fi

if [[ ! -f "$seed_entry" || ! -f "$seed_id_file" ]]; then
  echo "[bootstrap] image seed is incomplete" >&2
  exit 1
fi

seed_id=$(head -n 1 "$seed_id_file")
if [[ -z "$seed_id" ]]; then
  echo "[bootstrap] image seed identity is empty" >&2
  exit 1
fi

write_marker() {
  local target=$1
  local temporary="${target}.tmp-$$"
  printf '%s\n' "$seed_id" > "$temporary"
  mv "$temporary" "$target"
}

seed_runtime() {
  mkdir -p "$runtime_root/bin" "$runtime_root/lib/node_modules"
  cp -a "$seed_root/." "$runtime_root/"
}

replace_runtime() {
  local stamp stage previous
  stamp=$(date -u +%Y%m%dT%H%M%SZ)-$$
  stage="${runtime_package}.next-${stamp}"
  previous="${runtime_package}.previous-${stamp}"

  echo "[bootstrap] installing image-pinned OpenClaw $seed_id"
  cp -a "$seed_package" "$stage"
  node "$stage/openclaw.mjs" --version >/dev/null

  if [[ -e "$runtime_package" ]]; then
    mv "$runtime_package" "$previous"
  fi
  mv "$stage" "$runtime_package"
  mkdir -p "$runtime_root/bin"
  ln -sfn ../lib/node_modules/openclaw/openclaw.mjs "$runtime_root/bin/openclaw"

  if ! node "$runtime_entry" --version >/dev/null 2>&1; then
    echo "[bootstrap] new OpenClaw seed failed validation; restoring previous package" >&2
    rm -rf "$runtime_package"
    if [[ -e "$previous" ]]; then
      mv "$previous" "$runtime_package"
    fi
    exit 1
  fi

  rm -rf "$previous"
  write_marker "$runtime_id_file"
}

install_plugin_seed() {
  local plugin_id=$1
  local plugin_seed=$2
  local plugin_id_file="$runtime_root/.openclaw-${plugin_id}-seed-id"
  [[ -f "$plugin_seed" ]] || return 0
  if [[ -f "$plugin_id_file" ]] && [[ "$(head -n 1 "$plugin_id_file")" == "$seed_id" ]]; then
    return 0
  fi

  echo "[bootstrap] installing image-pinned $plugin_id plugin for $seed_id"
  if ! OPENCLAW_STATE_DIR="$state_dir" node "$runtime_entry" plugins install --force \
    "npm-pack:$plugin_seed"
  then
    echo "[bootstrap] $plugin_id plugin install deferred until the persisted config is valid" >&2
    return 0
  fi
  if ! OPENCLAW_STATE_DIR="$state_dir" node "$runtime_entry" plugins list --json 2>/dev/null | \
    node -e '
      let input = "";
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
        const parsed = JSON.parse(input);
        const plugins = Array.isArray(parsed) ? parsed : (parsed.plugins ?? []);
        const installed = plugins.find((plugin) => plugin.id === process.argv[1]);
        process.exit(installed?.enabled === true && installed?.status === "loaded" ? 0 : 1);
      });
    ' "$plugin_id"
  then
    echo "[bootstrap] $plugin_id plugin validation deferred until the persisted config is valid" >&2
    return 0
  fi
  write_marker "$plugin_id_file"
}

if [[ ! -f "$runtime_entry" ]]; then
  echo "[bootstrap] seeding package-managed OpenClaw onto the persistent volume"
  seed_runtime
elif ! node "$runtime_entry" --version >/dev/null 2>&1; then
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  echo "[bootstrap] existing OpenClaw package is unhealthy; preserving it and restoring the image seed"
  if [[ -e "$runtime_package" ]]; then
    mv "$runtime_package" "${runtime_package}.broken-${stamp}"
  fi
  if [[ -e "$runtime_root/bin/openclaw" || -L "$runtime_root/bin/openclaw" ]]; then
    mv "$runtime_root/bin/openclaw" "$runtime_root/bin/openclaw.broken-${stamp}"
  fi
  seed_runtime
fi

if [[ ! -f "$runtime_id_file" ]] || [[ "$(head -n 1 "$runtime_id_file")" != "$seed_id" ]]; then
  replace_runtime
fi

install_plugin_seed discord "$discord_seed"
install_plugin_seed codex "$codex_seed"

if [[ -f "$auth_order_repair" ]]; then
  node "$auth_order_repair" "$state_dir"
fi

if [[ -f "$tencent_patch" ]]; then
  if ! node "$tencent_patch" "$runtime_entry" "$state_dir"; then
    echo "[bootstrap] memory-tencentdb storage patch failed; continuing with the upstream plugin" >&2
  fi
fi

exec "$@"
