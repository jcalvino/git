# Tech Stack & Layout (Hybrid-Fetch)

Consistent with the user's existing tooling: Node.js 24, TypeScript,
Playwright (already used in `tradingview-bingx/tv-mcp/`), React + Vite
+ Tailwind (already used in the trading dashboard), Windows-friendly.

**Phase 1 (ON_DEMAND only) deliberately omits** mass-scraping infra —
no proxy pool, no CAPTCHA service, no scheduled crawlers. Those arrive
in Phase 3 *only* for sources whose `source_policies.fetchMode` is
flipped to `AGGREGATOR` after legal sign-off.

---

## Runtime

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript 5.x (strict) | Shared between API, web, worker |
| Node | 24 LTS | Matches user profile |
| Package manager | **pnpm** workspaces | Monorepo with internal packages |
| API framework | **Fastify** + Zod | Fast, typed, low-ceremony |
| Worker / queue | **BullMQ** on Redis | Used for async LLM calls (Phase 1); aggregator jobs (Phase 3) |
| Fetching | **Playwright** (Chromium) | ON_DEMAND Phase 1; AGGREGATOR Phase 3 |
| Partner API client | `undici` | Idealista Partner API when available |
| ORM | **Prisma** | Matches [SCHEMA.md](SCHEMA.md) |
| Database | **PostgreSQL 16** + `pgvector`, `postgis`, `pg_trgm`, `unaccent` |
| Object storage | **MinIO** (dev) / S3 (prod) | Raw HTML (30/90-day lifecycle) |
| LLM SDK | `@anthropic-ai/sdk` | Prompt caching enabled |
| Frontend | **React 18** + Vite + Tailwind + shadcn/ui | Consistent with trading dashboard |
| Charts | **Recharts** | Yield timelines, price history |
| Geo | Turf.js (client) + PostGIS (server) | ARU polygon hits |

### Phase-1 explicit non-deps (to avoid scope creep)

- ❌ Proxy rotation pool
- ❌ Residential proxy provider
- ❌ CAPTCHA-solving service
- ❌ Scheduler for crawl jobs (BullMQ stays, but no repeatable jobs for fetching)
- ❌ Search-page parsers

These become in-scope in Phase 3 **per source** only after the
[LEGAL.md §4 checklist](LEGAL.md) passes for that source.

---

## Directory layout

```
Real_estate/
├── README.md
├── ROADMAP.md
├── STACK.md
├── SCHEMA.md
├── TAX_RULES_PT.md
├── FINANCE_SPEC.md
├── AGENTS.md
├── LEGAL.md
├── docker-compose.yml            # postgres + redis + minio
├── .env.example
├── package.json                  # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
│
├── docs/
│   ├── retention/                # retention job specs
│   └── tos-reviews/              # per-source legal reviews (Phase 3 prereq)
│
├── apps/
│   ├── api/                      # Fastify app
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── analyze.ts    # POST /analyze — ON_DEMAND entry point
│   │   │   │   ├── properties.ts # GET /properties (Phase 2+)
│   │   │   │   └── auth.ts       # magic-link email (Phase 2)
│   │   │   ├── middleware/
│   │   │   │   ├── policyGate.ts # reads source_policies, hard-fails 451
│   │   │   │   └── rateLimit.ts
│   │   │   └── server.ts
│   │   └── package.json
│   │
│   ├── web/                      # React + Vite dashboard
│   │   ├── src/
│   │   │   ├── pages/
│   │   │   │   ├── Analyze.tsx   # paste-URL view (Phase 1 primary)
│   │   │   │   ├── Dashboard.tsx # filtered cards (Phase 3+)
│   │   │   │   └── Property.tsx  # detail + breakdown
│   │   │   ├── components/
│   │   │   │   ├── FiscalTable.tsx
│   │   │   │   ├── CapexPanel.tsx
│   │   │   │   ├── MortgageSimulator.tsx
│   │   │   │   ├── YieldPanel.tsx
│   │   │   │   ├── RiskBadges.tsx
│   │   │   │   └── Disclaimer.tsx     # LEGAL.md §7 content
│   │   │   └── lib/api.ts
│   │   └── vite.config.ts
│   │
│   └── worker/                   # BullMQ processors
│       ├── src/
│       │   ├── queues.ts
│       │   ├── jobs/
│       │   │   ├── runAnalysis.ts    # async Advisor LLM call
│       │   │   ├── refreshRates.ts   # weekly Euribor + spreads
│       │   │   ├── rollupRegions.ts  # weekly median rollup (Phase 4)
│       │   │   ├── retention.ts      # nightly purge
│       │   │   └── aggregateSource.ts   # Phase 3, per source, gated
│       │   └── main.ts
│       └── package.json
│
├── packages/
│   ├── shared/                   # types + JSON contracts
│   │   └── src/
│   │       ├── contracts.ts      # InvestmentSummary, Property, ...
│   │       └── enums.ts
│   │
│   ├── finance/                  # deterministic math
│   │   └── src/
│   │       ├── imt.ts
│   │       ├── stamp.ts
│   │       ├── capex.ts
│   │       ├── mortgage.ts
│   │       ├── yields.ts
│   │       ├── risk.ts
│   │       └── __tests__/
│   │           ├── imt.test.ts       # golden cases from TAX_RULES_PT §1.3
│   │           ├── capex.test.ts
│   │           └── ...
│   │
│   ├── fetchers/                 # (was: scrapers) — hybrid-fetch adapters
│   │   └── src/
│   │       ├── fetcher.ts        # public entry; enforces policyGate
│   │       ├── policyGate.ts     # reads source_policies
│   │       ├── circuitBreaker.ts # 3× 403/CAPTCHA → disable
│   │       ├── adapters/
│   │       │   ├── idealista.ts      # ON_DEMAND (Phase 1) / API (Phase 2+)
│   │       │   ├── imovirtual.ts     # ON_DEMAND only
│   │       │   ├── casaSapo.ts       # ON_DEMAND → AGGREGATOR candidate (Ph3)
│   │       │   ├── casaYes.ts        # ON_DEMAND → AGGREGATOR candidate (Ph3)
│   │       │   └── quatru.ts         # ON_DEMAND → AGGREGATOR candidate (Ph3)
│   │       ├── normalizer.ts     # DOM + Haiku 4.5 free-text pass
│   │       ├── dedup.ts          # fingerprint + fuzzy match
│   │       └── rateLimiter.ts
│   │
│   ├── agents/                   # LLM orchestration
│   │   └── src/
│   │       ├── orchestrate.ts    # main pipeline function
│   │       ├── advisor.ts        # Sonnet 4.6 call + cache
│   │       ├── normalizerLlm.ts  # Haiku 4.5 free-text pass
│   │       ├── benchmark.ts      # Phase 4
│   │       ├── prompts/
│   │       │   ├── advisorSystem.md
│   │       │   └── normalizerSystem.md
│   │       └── tools/            # tool-use definitions (V2)
│   │
│   └── db/                       # Prisma schema + migrations + seeds
│       ├── prisma/
│       │   ├── schema.prisma
│       │   ├── migrations/
│       │   └── seed.ts           # tax_brackets, imi_rates, aru_zones, source_policies
│       └── src/
│           ├── client.ts
│           └── retention.ts
│
└── infra/
    ├── docker-compose.yml        # dev stack
    ├── grafana/                  # dashboards (Phase 5)
    └── github-actions/
        └── ci.yml
```

---

## Environment variables (`.env.example`)

```
# core
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/real_estate
REDIS_URL=redis://localhost:6379
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=...
MINIO_SECRET_KEY=...

# LLM
ANTHROPIC_API_KEY=sk-ant-...
LLM_MODEL_ADVISOR=claude-sonnet-4-6
LLM_MODEL_NORMALIZER=claude-haiku-4-5-20251001
LLM_DAILY_CAP_EUR=20

# hybrid fetch — global feature flags
AGGREGATOR_ENABLED=false          # master switch, default OFF
FETCH_USER_AGENT=RealEstateInvestmentAnalyzer/1.0 (+https://your-domain/contact)

# ON_DEMAND rate limit (per authenticated user)
ONDEMAND_RATE_PER_MIN=6

# partner API (set when Idealista approves)
IDEALISTA_API_KEY=
IDEALISTA_API_SECRET=

# email / magic-link
SMTP_URL=

# mortgage data refresh
EURIBOR_SOURCE=ecb                # or "manual"
```

Note: `AGGREGATOR_ENABLED=false` is the **master kill switch**. Even if a
`source_policies` row says `AGGREGATOR`, nothing scheduled will fire unless
this flag is `true` **and** the per-source ToS review is on file.

---

## CI pipeline (GitHub Actions)

1. `pnpm install --frozen-lockfile`
2. Type-check all workspaces.
3. Lint (ESLint, strict).
4. Unit tests — **must include all IMT golden cases from TAX_RULES_PT**.
5. Prisma migrate validate (dry run against disposable Postgres).
6. **Policy-gate tests**: mocked `source_policies` → verify fetcher hard-fails
   when mode is disallowed; verify `AGGREGATOR_ENABLED=false` blocks all
   scheduled jobs.
7. Fetcher smoke test against **fixture HTML** (no live hits in CI).
8. Build web bundle; fail on size regression > 10%.

---

## Local dev quick-start

```bash
# from Real_estate/
cp .env.example .env
docker compose up -d                 # postgres + redis + minio
pnpm install
pnpm -C packages/db migrate:dev
pnpm -C packages/db seed             # tax_brackets + source_policies (all ON_DEMAND)
pnpm dev                             # concurrently: api + web + worker
```

Windows note: keep scripts `shell: true` for `.cmd` bins (pnpm, npx);
Playwright's Chromium launch uses `windowsHide: true`.

First manual test:

```bash
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.idealista.pt/imovel/XXXXXXXX/", "use":"INVESTMENT"}'
```

Expect:
- `fetch_runs` row with `mode=ON_DEMAND`.
- One `Property` row + one `Analysis` row.
- Total latency < 15 s on a cold cache.

---

## Observability (Phase 5)

| Signal | Tool |
|---|---|
| Structured logs | Pino → Loki |
| Metrics | Prometheus (p95 `/analyze` latency, LLM cost, policy-gate rejects, circuit-breaker trips) |
| Errors | Sentry |
| Dashboards | Grafana |
| LLM traces | Anthropic console + `llm_calls` table |

Key SLOs:
- `POST /analyze` p95 < 8 s (cold), < 1 s (cached).
- Policy-gate reject rate ≤ 1% (higher means UI is offering forbidden URLs).
- LLM cache hit rate ≥ 85%.
- Zero unauthorized AGGREGATOR runs (alert on any `fetch_runs.mode=AGGREGATOR`
  where `source_policies.fetchMode != AGGREGATOR` at the time).
- CI green rate on `main` ≥ 98%.
