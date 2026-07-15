FROM node:22-bookworm AS openclaw-seed

# Seed the persistent Railway volume from a verified npm release. The running
# copy lives under /data/npm, so `openclaw update` uses package-manager mode and
# survives restarts/redeploys without ever depending on a mutable Git checkout.
ARG OPENCLAW_VERSION=2026.7.1
RUN mkdir -p /opt/openclaw-seed \
  && npm install --global --prefix /opt/openclaw-seed --omit=dev "openclaw@${OPENCLAW_VERSION}" \
  && /opt/openclaw-seed/bin/openclaw --version \
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
COPY scripts/docker-entrypoint.sh /usr/local/bin/openclaw-railway-entrypoint
RUN chmod +x /usr/local/bin/openclaw-railway-entrypoint

COPY src ./src

EXPOSE 8080

ENTRYPOINT ["tini", "--", "/usr/local/bin/openclaw-railway-entrypoint"]
CMD ["node", "src/server.js"]
