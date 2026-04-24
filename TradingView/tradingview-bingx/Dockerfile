# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────────
#  tradingview-bingx — Portable container image
#  Multi-stage: builds dashboard, ships minimal Node 20 runtime.
# ─────────────────────────────────────────────────────────────────

# ── Stage 1: build dashboard (React + Vite) ──────────────────────
# Node 22+ é obrigatório no runtime por causa de `node:sqlite`
# (built-in só existe a partir de v22.5). Mantém 22 também no
# builder do dashboard por consistência de cache.
FROM node:22-alpine AS dashboard-builder
WORKDIR /app/dashboard
COPY dashboard/package*.json ./
RUN npm ci --no-audit --no-fund
COPY dashboard/ ./
RUN npm run build

# ── Stage 2: runtime ─────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# Install tini as PID 1 so SIGTERM propagates to all child processes
RUN apk add --no-cache tini curl

# Install production deps for the main app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# App source (bot, api, scripts, config, strategy, skills)
COPY src/     ./src/
COPY scripts/ ./scripts/
COPY skills/  ./skills/
COPY rules.json monitors.json ./

# Bring in the built dashboard static files
COPY --from=dashboard-builder /app/dashboard/dist ./dashboard/dist
COPY dashboard/package.json ./dashboard/package.json

# Data directory is a mount point — state (DB, logs, pids) lives here
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000 3001

ENV NODE_ENV=production
ENV TV_RULES_PATH=/app/rules.json
ENV DB_PATH=/app/data/trades.db

# Health check: API reports OK
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3001/api/health || exit 1

# tini forwards signals cleanly so `docker stop` kills all child nodes
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "scripts/docker-start.js"]
