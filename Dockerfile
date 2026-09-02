FROM node:22-bookworm AS openclaw-seed

# Seed production exclusively from the published stable packages. Exact pins
# make the deployed image reproducible and exclude the Codex voice test fork.
ARG OPENCLAW_VERSION=2026.7.1-2
ARG OPENCLAW_CODEX_VERSION=2026.7.1-1
ARG OPENCLAW_DISCORD_VERSION=2026.7.1
RUN mkdir -p /opt/openclaw-seed \
  && npm install --global --prefix /opt/openclaw-seed --omit=dev \
      "openclaw@${OPENCLAW_VERSION}" \
  && /opt/openclaw-seed/bin/openclaw --version \
  && printf '%s\n' "openclaw@${OPENCLAW_VERSION}" \
      > /opt/openclaw-seed/.openclaw-seed-id
RUN mkdir -p /opt/openclaw-codex-package \
  && npm pack --ignore-scripts --pack-destination /opt/openclaw-codex-package \
      "@openclaw/codex@${OPENCLAW_CODEX_VERSION}" \
  && test "$(find /opt/openclaw-codex-package -maxdepth 1 -type f -name '*.tgz' | wc -l)" -eq 1 \
  && mv /opt/openclaw-codex-package/*.tgz /opt/openclaw-codex.tgz
RUN mkdir -p /opt/openclaw-discord-package \
  && npm pack --ignore-scripts --pack-destination /opt/openclaw-discord-package \
      "@openclaw/discord@${OPENCLAW_DISCORD_VERSION}" \
  && test "$(find /opt/openclaw-discord-package -maxdepth 1 -type f -name '*.tgz' | wc -l)" -eq 1 \
  && mv /opt/openclaw-discord-package/*.tgz /opt/openclaw-discord.tgz \
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

COPY --from=openclaw-seed /opt/openclaw-seed /opt/openclaw-seed
COPY --from=openclaw-seed /opt/openclaw-codex.tgz /opt/openclaw-codex.tgz
COPY --from=openclaw-seed /opt/openclaw-discord.tgz /opt/openclaw-discord.tgz
COPY scripts/docker-entrypoint.sh /usr/local/bin/openclaw-railway-entrypoint
COPY scripts/repair-stale-auth-order.mjs /usr/local/lib/openclaw/repair-stale-auth-order.mjs
COPY scripts/patch-memory-tencentdb.mjs /usr/local/lib/openclaw/patch-memory-tencentdb.mjs
RUN chmod +x /usr/local/bin/openclaw-railway-entrypoint

COPY src ./src

EXPOSE 8080

ENTRYPOINT ["tini", "--", "/usr/local/bin/openclaw-railway-entrypoint"]
CMD ["node", "src/server.js"]
