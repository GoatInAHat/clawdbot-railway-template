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
codex_id_file="$runtime_root/.openclaw-codex-seed-id"
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

install_codex_seed() {
  [[ -f "$codex_seed" ]] || return 0
  if [[ -f "$codex_id_file" ]] && [[ "$(head -n 1 "$codex_id_file")" == "$seed_id" ]]; then
    return 0
  fi

  echo "[bootstrap] installing image-pinned Codex provider for $seed_id"
  OPENCLAW_STATE_DIR="$state_dir" node "$runtime_entry" plugins install --force \
    "npm-pack:$codex_seed"
  if [[ ! -f "$state_dir/extensions/codex/openclaw.plugin.json" ]]; then
    echo "[bootstrap] Codex provider install did not produce the expected extension" >&2
    exit 1
  fi
  write_marker "$codex_id_file"
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

install_codex_seed

exec "$@"
