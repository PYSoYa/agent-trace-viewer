# SQLite comes from Node's built-in `node:sqlite`, so there is no native module
# to compile and no build toolchain in the final image.
#
# `node:sqlite` must be available *without* a CLI flag. That is true on modern
# Node; if you hit a base image where it isn't, override the version:
#   docker build --build-arg NODE_VERSION=26 .
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS base
# Fail the build here rather than letting the container start and die on the
# first query. This is the one runtime capability the app cannot work without.
RUN node -e "const {DatabaseSync}=require('node:sqlite'); const d=new DatabaseSync(':memory:'); d.exec('CREATE TABLE t(a)'); console.log('node:sqlite available')"
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    # Mount the host's agent logs here, read-only.
    CLAUDE_PROJECTS_DIR=/claude-projects \
    CODEX_SESSIONS_DIR=/codex-sessions \
    CODEX_SESSION_INDEX=/codex-session-index.jsonl \
    # Index lives on a volume so it survives restarts.
    TRACE_DATA_DIR=/data

RUN addgroup -g 1001 -S nodejs \
 && adduser -u 1001 -S nextjs -G nodejs \
 && mkdir -p /data /claude-projects /codex-sessions \
 && chown -R nextjs:nodejs /data

# `output: "standalone"` emits a self-contained server plus only the
# node_modules it actually needs.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
VOLUME ["/data"]

CMD ["node", "server.js"]
