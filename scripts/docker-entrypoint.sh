#!/usr/bin/env bash
set -euo pipefail

seed_root=/opt/openclaw-seed
runtime_root=${NPM_CONFIG_PREFIX:-/data/npm}
runtime_package="$runtime_root/lib/node_modules/openclaw"
runtime_entry="$runtime_package/openclaw.mjs"

seed_runtime() {
  mkdir -p "$runtime_root/bin" "$runtime_root/lib/node_modules"
  cp -a "$seed_root/." "$runtime_root/"
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

exec "$@"
