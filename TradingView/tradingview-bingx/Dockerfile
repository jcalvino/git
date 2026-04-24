# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────────
#  tradingview-bingx — Portable container image
#
#  Multi-stage: builds dashboard (Vite), ships minimal Node 22 runtime.
#
#  Filosofia desta imagem:
#    - `COPY . .` no estágio de runtime copia o projeto inteiro,
#      respeitando .dockerignore. Qualquer arquivo ou pasta novo
#      adicionado no repo entra automaticamente no próximo rebuild,
#      sem precisar editar este Dockerfile.
#    - Dashboard é sempre buildado a partir do src atual.
#    - `scripts/docker-start.js` cuida do startup (repo-health,
#      update-rules, api, scanner, monitor, dashboard estático
#      com proxy /api → :3001).
#
#  Para atualizar a imagem depois de mexer no código:
#      npm run docker:up         # = docker compose up -d --build
# ─────────────────────────────────────────────────────────────────


# ── Stage 1: build dashboard (React + Vite) ──────────────────────
# Node 22 por consistência com o runtime.
FROM node:22-alpine AS dashboard-builder
WORKDIR /app/dashboard

# Instala deps do dashboard primeiro (camada cacheada enquanto
# package.json do dashboard não mudar).
COPY dashboard/package*.json ./
RUN npm ci --no-audit --no-fund

# Copia o source e builda.
COPY dashboard/ ./
RUN npm run build


# ── Stage 2: runtime ─────────────────────────────────────────────
# Node 22 é obrigatório por causa de `node:sqlite` (built-in só
# existe a partir de v22.5).
FROM node:22-alpine AS runtime
WORKDIR /app

# tini: PID 1 que propaga sinais corretamente para filhos
# (docker stop → SIGTERM → shutdown limpo). curl: healthcheck.
RUN apk add --no-cache tini curl

# Deps de produção do app principal (camada cacheada enquanto
# package.json / lock não mudarem).
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Copia o restante do projeto. O .dockerignore garante que
# node_modules/, data/, .env, .git, logs e builds antigos fiquem
# de fora. Qualquer pasta nova do repo (research/, docs/, etc.)
# é incluída automaticamente aqui — sem edição deste Dockerfile.
COPY . .

# Substitui o dashboard/dist do host (que pode estar stale ou
# nem existir, porque o .dockerignore o exclui) pelo bundle
# recém-buildado no estágio anterior.
COPY --from=dashboard-builder /app/dashboard/dist ./dashboard/dist

# Diretórios de estado que devem existir e ser montados como
# volume para persistência entre rebuilds.
RUN mkdir -p /app/data /app/research

VOLUME ["/app/data", "/app/research"]

EXPOSE 3000 3001

ENV NODE_ENV=production
ENV TV_RULES_PATH=/app/rules.json
ENV DB_PATH=/app/data/trades.db

# Healthcheck: API responde em /api/health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3001/api/health || exit 1

# tini encaminha sinais — `docker stop` finaliza todos os node.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--experimental-sqlite", "scripts/docker-start.js"]
