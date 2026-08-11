ARG OPENCLAW_NODE_IMAGE="docker.io/library/node:24-bookworm@sha256:5711a0d445a1af54af9589066c646df387d1831a608226f4cd694fc59e745059"

FROM ${OPENCLAW_NODE_IMAGE} AS openclaw-source

# Build the Codex realtime voice PR from its reviewed immutable commit.
ARG OPENCLAW_SOURCE_REPOSITORY=https://github.com/GoatInAHat/openclaw.git
ARG OPENCLAW_SOURCE_REF=80795a6d368d5c903fdbf39a03266aca9ffd47bc
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*
RUN git init /src/openclaw \
  && cd /src/openclaw \
  && git remote add origin "${OPENCLAW_SOURCE_REPOSITORY}" \
  && git fetch --depth=1 origin "${OPENCLAW_SOURCE_REF}" \
  && git checkout --detach FETCH_HEAD \
  && test "$(git rev-parse HEAD)" = "${OPENCLAW_SOURCE_REF}"
WORKDIR /src/openclaw
RUN corepack enable \
  && pnpm install --frozen-lockfile
RUN node scripts/package-openclaw-for-docker.mjs \
      --allow-unreleased-changelog \
      --output-dir /opt/openclaw-package \
      --output-name openclaw.tgz \
  && mkdir -p /opt/openclaw-seed \
  && npm install --global --prefix /opt/openclaw-seed --omit=dev \
      /opt/openclaw-package/openclaw.tgz \
  && /opt/openclaw-seed/bin/openclaw --version
RUN for plugin in codex discord voice-call; do \
      mkdir -p "/opt/openclaw-${plugin}-package"; \
      node scripts/lib/plugin-npm-runtime-build.mjs "extensions/${plugin}"; \
      node scripts/lib/plugin-npm-package-manifest.mjs --run "extensions/${plugin}" -- \
        npm pack --json --ignore-scripts --pack-destination "/opt/openclaw-${plugin}-package"; \
      test "$(find "/opt/openclaw-${plugin}-package" -maxdepth 1 -type f -name '*.tgz' | wc -l)" -eq 1; \
      mv "/opt/openclaw-${plugin}-package"/*.tgz "/opt/openclaw-${plugin}.tgz"; \
    done \
  && test -f /src/openclaw/dist/extensions/codex/index.js \
  && mkdir -p /opt/openclaw-codex-deps \
  && npm install --prefix /opt/openclaw-codex-deps --omit=dev --omit=peer --no-save \
      /opt/openclaw-codex.tgz \
  && mkdir -p /opt/openclaw-seed/lib/node_modules/openclaw/dist/extensions/codex \
  && cp -a /src/openclaw/dist/extensions/codex/. \
      /opt/openclaw-seed/lib/node_modules/openclaw/dist/extensions/codex/ \
  && mv /opt/openclaw-codex-deps/node_modules \
      /opt/openclaw-seed/lib/node_modules/openclaw/dist/extensions/codex/node_modules \
  && test -f /src/openclaw/dist/extensions/voice-call/index.js \
  && mkdir -p /opt/openclaw-voice-call-deps \
  && npm install --prefix /opt/openclaw-voice-call-deps --omit=dev --omit=peer --no-save \
      /opt/openclaw-voice-call.tgz \
  && mkdir -p /opt/openclaw-seed/lib/node_modules/openclaw/dist/extensions/voice-call \
  && cp -a /src/openclaw/dist/extensions/voice-call/. \
      /opt/openclaw-seed/lib/node_modules/openclaw/dist/extensions/voice-call/ \
  && mv /opt/openclaw-voice-call-deps/node_modules \
      /opt/openclaw-seed/lib/node_modules/openclaw/dist/extensions/voice-call/node_modules \
  && printf '%s\n' "openclaw-source@${OPENCLAW_SOURCE_REF}+bundled-codex-voice-call-v2" \
      > /opt/openclaw-seed/.openclaw-seed-id \
  && npm cache clean --force
RUN for plugin in codex voice-call; do \
      OPENCLAW_STATE_DIR=/tmp/openclaw-bundled-plugin-check \
        /opt/openclaw-seed/bin/openclaw plugins inspect "$plugin" --json \
      | node -e 'let input = ""; process.stdin.on("data", (chunk) => { input += chunk; }); process.stdin.on("end", () => { const inspected = JSON.parse(input); process.exit(inspected.plugin?.origin === "bundled" ? 0 : 1); });'; \
    done

FROM ${OPENCLAW_NODE_IMAGE}
ENV NODE_ENV=production

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    tini \
    python3 \
    python3-venv \
  && rm -rf /var/lib/apt/lists/*

# Keep package/plugin installs on the Railway volume. A compatible pnpm is also
# available for OpenClaw-managed plugin operations that need it.
RUN corepack enable && corepack prepare pnpm@11.15.1 --activate
ENV NPM_CONFIG_PREFIX=/data/npm
ENV NPM_CONFIG_CACHE=/data/npm-cache
ENV PNPM_HOME=/data/pnpm
ENV PNPM_STORE_DIR=/data/pnpm-store
ENV PATH="/data/npm/bin:/data/pnpm:${PATH}"

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=openclaw-source /opt/openclaw-seed /opt/openclaw-seed
COPY --from=openclaw-source /opt/openclaw-discord.tgz /opt/openclaw-discord.tgz
COPY scripts/docker-entrypoint.sh /usr/local/bin/openclaw-railway-entrypoint
COPY scripts/repair-stale-auth-order.mjs /usr/local/lib/openclaw/repair-stale-auth-order.mjs
COPY scripts/patch-memory-tencentdb.mjs /usr/local/lib/openclaw/patch-memory-tencentdb.mjs
RUN chmod +x /usr/local/bin/openclaw-railway-entrypoint

COPY src ./src

EXPOSE 8080

ENTRYPOINT ["tini", "--", "/usr/local/bin/openclaw-railway-entrypoint"]
CMD ["node", "src/server.js"]
