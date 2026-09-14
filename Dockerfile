ARG BUN_VERSION=1.4.2
ARG NODE_VERSION=22
ARG UV_VERSION=0.11.7

FROM oven/bun:${BUN_VERSION}-slim AS bun
FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv

FROM bun AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/schema/package.json packages/schema/
COPY apps/gateway/package.json apps/gateway/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile

FROM bun AS web
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/apps/web/node_modules apps/web/node_modules
COPY --from=deps /app/packages/schema/node_modules packages/schema/node_modules
COPY . .
RUN bun run build:web

FROM bun AS runtime-deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/schema/package.json packages/schema/
COPY apps/gateway/package.json apps/gateway/
RUN bun install --frozen-lockfile --production --omit=optional

FROM node:${NODE_VERSION}-bookworm-slim

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=uv /uv /uvx /usr/local/bin/

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* \
  && ln -s /usr/local/bin/bun /usr/local/bin/bunx \
  && groupadd --system --gid 10001 junctio \
  && useradd --system --uid 10001 --gid junctio --home-dir /home/junctio --create-home junctio \
  && mkdir -p /data /cache/npm /cache/bun /cache/uv /cache/tmp \
  && chown -R junctio:junctio /data /cache

WORKDIR /app

COPY --from=runtime-deps --chown=junctio:junctio /app/node_modules node_modules
COPY --from=runtime-deps --chown=junctio:junctio /app/apps/gateway/node_modules apps/gateway/node_modules
COPY --from=runtime-deps --chown=junctio:junctio /app/packages/schema/node_modules packages/schema/node_modules
COPY --chown=junctio:junctio package.json tsconfig.base.json ./
COPY --chown=junctio:junctio packages packages
COPY --chown=junctio:junctio apps/gateway/package.json apps/gateway/tsconfig.json apps/gateway/
COPY --chown=junctio:junctio apps/gateway/src apps/gateway/src
COPY --chown=junctio:junctio apps/web/package.json apps/web/
COPY --from=web --chown=junctio:junctio /app/apps/web/dist apps/web/dist

ENV NODE_ENV=production \
    HOME=/home/junctio \
    JUNCTIO_DATA_DIR=/data \
    JUNCTIO_PUBLIC_DIR=/app/apps/web/dist \
    PORT=3000 \
    HOST=0.0.0.0 \
    NPM_CONFIG_CACHE=/cache/npm \
    BUN_INSTALL_CACHE_DIR=/cache/bun \
    UV_CACHE_DIR=/cache/uv \
    XDG_CACHE_HOME=/cache \
    TMPDIR=/cache/tmp

VOLUME ["/data", "/cache"]
EXPOSE 3000
USER junctio

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bun", "apps/gateway/src/cli/index.ts", "serve"]
