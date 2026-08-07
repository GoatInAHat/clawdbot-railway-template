FROM node:24-bookworm AS openclaw-source

# Build the latest stable release plus the reviewed native Discord voice patch
# from an immutable commit. Codex is an external provider in this release, so
# its package is built from the same source snapshot and seeded alongside core.
ARG OPENCLAW_SOURCE_REPOSITORY=https://github.com/GoatInAHat/openclaw.git
ARG OPENCLAW_SOURCE_REF=2dbf2d293843120fbdeb9c0286f53848ab6e6179
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
RUN for plugin in codex discord; do \
      mkdir -p "/opt/openclaw-${plugin}-package"; \
      node scripts/lib/plugin-npm-runtime-build.mjs "extensions/${plugin}"; \
      node scripts/lib/plugin-npm-package-manifest.mjs --run "extensions/${plugin}" -- \
        npm pack --json --ignore-scripts --pack-destination "/opt/openclaw-${plugin}-package"; \
      test "$(find "/opt/openclaw-${plugin}-package" -maxdepth 1 -type f -name '*.tgz' | wc -l)" -eq 1; \
      mv "/opt/openclaw-${plugin}-package"/*.tgz "/opt/openclaw-${plugin}.tgz"; \
    done \
  && printf '%s\n' "openclaw@2026.7.1-2+${OPENCLAW_SOURCE_REF}" \
      > /opt/openclaw-seed/.openclaw-seed-id \
  && npm cache clean --force

FROM node:22-bookworm
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
RUN corepack enable && corepack prepare pnpm@11.2.2 --activate
ENV NPM_CONFIG_PREFIX=/data/npm
ENV NPM_CONFIG_CACHE=/data/npm-cache
ENV PNPM_HOME=/data/pnpm
ENV PNPM_STORE_DIR=/data/pnpm-store
ENV PATH="/data/npm/bin:/data/pnpm:${PATH}"

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=openclaw-source /opt/openclaw-seed /opt/openclaw-seed
COPY --from=openclaw-source /opt/openclaw-codex.tgz /opt/openclaw-codex.tgz
COPY --from=openclaw-source /opt/openclaw-discord.tgz /opt/openclaw-discord.tgz
COPY scripts/docker-entrypoint.sh /usr/local/bin/openclaw-railway-entrypoint
RUN chmod +x /usr/local/bin/openclaw-railway-entrypoint

COPY src ./src

EXPOSE 8080

ENTRYPOINT ["tini", "--", "/usr/local/bin/openclaw-railway-entrypoint"]
CMD ["node", "src/server.js"]
