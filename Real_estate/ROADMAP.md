# Technical Roadmap — Hybrid Fetch

Five phases. Phase 1 ships a **legally defensible MVP** with zero mass
scraping. Aggregation only appears in Phase 3, gated by
[LEGAL.md §4](LEGAL.md).

---

## Phase 0 — Foundation (Week 1)

**Exit:** `source_policies` seeded, deterministic engine green, one URL
fetched on-demand from Idealista produces a complete normalized `Property`.

- Monorepo scaffold (`apps/api`, `apps/web`, `apps/worker`,
  `packages/finance`, `packages/agents`, `packages/fetchers`,
  `packages/shared`, `packages/db`). pnpm workspaces.
- Postgres 16 + `pgvector` + `postgis` + Redis via `docker-compose`.
- Prisma schema + migrations. See [SCHEMA.md](SCHEMA.md).
- Seeds:
  - `tax_brackets` from [TAX_RULES_PT.md](TAX_RULES_PT.md) (both HPP and Investment, OE2026).
  - `source_policies`: all 5 sources set to `ON_DEMAND` (see [LEGAL.md §2](LEGAL.md)).
  - `imi_rates` continental median 0.38%.
  - `aru_zones`: Lisboa + Porto parish list.
- One `Fetcher_Agent` source adapter: Idealista detail page only.
- Normalizer: raw HTML → canonical `Property` (+ Haiku 4.5 free-text pass).
- GitHub Actions: lint, type-check, finance unit tests, Prisma migration check.

**Out of scope (deferred):** BullMQ queue processors, proxy rotation,
CAPTCHA handling, search-page crawlers.

---

## Phase 1 — MVP: On-Demand URL Analysis (Weeks 2-3)

**Mode:** `ON_DEMAND` for all 5 sources.
**Exit:** paste any URL from any of the 5 sources → full InvestmentSummary
JSON in < 15 s, hard-gated by `source_policies`.

### 1.1 Finance engine — `packages/finance`

Pure TypeScript. Spec: [FINANCE_SPEC.md](FINANCE_SPEC.md). Golden tests
must pass to the cent (HPP €250k → €7,042.04, INVESTMENT €250k → €8,105.50, ...).

### 1.2 Fetcher_Agent — `packages/fetchers`

- One adapter per source (5 total).
- **No scheduler. No queue. Exactly one HTTP request per `POST /analyze` call.**
- `FetchPolicy` middleware hard-fails any call whose `source_policies.fetch_mode`
  is not `ON_DEMAND` or `API`.
- Per-user token-bucket rate limit: 6 analyses / minute.
- Honest `User-Agent`.
- Raw HTML → MinIO with 30-day lifecycle.

### 1.3 API — `apps/api`

- `POST /analyze { url, financing?, use? }` → `InvestmentSummary`.
- Auto-detect source from URL hostname; reject if not in `source_policies`.
- Idempotency key: `sha256(url + financing + use)` → cached `analyses` row.
- Zod validation, Fastify, per-IP rate limit.

### 1.4 Advisor agent — `packages/agents`

- Claude Sonnet 4.6, prompt-cached system prompt.
- Inputs: deterministic engine outputs + `scraperRedFlags` from normalizer.
- Output JSON: `{ recommended, confidence, redFlags[], reasoning }`.

### 1.5 UI — `apps/web`

- Single page: URL input → loading → `InvestmentSummary` render.
- Fiscal table, CAPEX panel, mortgage simulator (LTV 80–90%, years 25–40),
  yields, Flip/Rent risk badges, red flags, advisor reasoning.
- Every numeric cell has a tooltip showing the formula.
- Disclaimer ([LEGAL.md §7](LEGAL.md)) pinned to the result view.

### 1.6 Legal artifacts

- `LEGAL.md` live in-repo and linked from UI footer.
- `docs/retention/` has the nightly job spec.
- `docs/tos-reviews/` folder created (empty until Phase 3 candidates).

---

## Phase 2 — Scale & Partner API (Weeks 4-5)

**Mode:** still `ON_DEMAND` everywhere. Partnership admin runs in parallel.

- Submit **Idealista Partner API** application Week 4 day 1.
- Magic-link email auth.
- User accounts, saved analyses.
- "Re-analyze" action on a saved property (respecting rate limit).
- Finance simulator V2: sensitivity sliders (Euribor ±100 bp, vacancy 0–20%).
- PDF export: one-page "memorando de investimento".
- Observability baseline: Pino logs, Prometheus metrics, Sentry.

**If Partner API is approved during Phase 2:**
- Flip `source_policies[idealista].fetch_mode = 'API'`.
- Implement API adapter (`packages/fetchers/src/adapters/idealistaApi.ts`).
- Remove Playwright fallback for Idealista.

---

## Phase 3 — Gated Aggregator (Weeks 6-9)

**Mode:** introduce `AGGREGATOR`, but **only** for sources whose
[LEGAL.md §4 checklist](LEGAL.md) is satisfied. Realistic candidates:
Casa SAPO, CasaYes, Quatru. Idealista/Imovirtual stay `ON_DEMAND` or `API`.

### 3.1 ToS reviews

- Write `docs/tos-reviews/casasapo-<date>.md`, `casayes-<date>.md`,
  `quatru-<date>.md`. Lawyer sign-off required.
- Flip `source_policies.fetch_mode = 'AGGREGATOR'` only after sign-off.

### 3.2 Aggregator infra

- BullMQ repeatable jobs per source, per region.
- Rate limit: 1 req / 6 s, jittered, hard-policed in `Fetcher_Agent`.
- Daily volume cap per source (< 2,000 req/day MVP).
- Circuit breaker: 3× 403 / CAPTCHA → auto-disable + on-call alert.
- Cross-source dedup: `(address_normalized, area_bucket, price_bucket)` fingerprint.
- `property_snapshots` — price change history, DOM tracking.

### 3.3 Dashboard

- Filters: freguesia multi-select, price, typology, area, min net yield,
  max €/m² vs. regional median, energy cert floor.
- Property cards with verdict badge + delta vs. "Valor de Escritura".
- Watchlist (magic-link auth, email notifications on price drop).

---

## Phase 4 — Regional Intelligence (Weeks 10-12)

### 4.1 Vector memory (pgvector)

- Embed `{description, region, typology, features}` with `voyage-3-large`.
- User preference vector (EMA over saves/rejects).
- "Similar properties" ANN search — never across AGGREGATOR-disabled sources.

### 4.2 Regional trends

- Weekly rollup: median €/m², volume, DoM by freguesia.
- Time-series in `region_trends`.
- Advisor prompt picks up 12-month trend slice as additional context.

### 4.3 Benchmark agent (V2)

- Dedicated `Benchmark_Agent` with tool-use: `get_region_trends`,
  `find_similar_properties`, `get_escritura_value`.
- Advisor consumes its paragraph as extra context.

### 4.4 External integrations

- Euribor 12m + top-5 PT bank spreads (weekly).
- Annual OE / AT tax-table refresh migration (Jan).
- Optional: INE / SIGIMI indices if accessible.

---

## Phase 5 — Polish & Hardening (Weeks 13-14)

- Circuit breakers for all sources, CAPTCHA detection tuning.
- LLM daily cost hard-stop (`LLM_DAILY_CAP_EUR`).
- Mobile-responsive dashboard.
- Full legal review (PT counsel) before any public launch.
- Retention job dashboard (so anyone can see what was purged).
- CNPD (GDPR authority) contact ready if scale warrants.

---

## Explicit non-goals

- Not a brokerage; no transaction facilitation.
- Not financial, fiscal, or legal advice.
- No scraping of authenticated / private pages, ever.
- No mass scraping of Idealista or Imovirtual at any phase.
- No reselling or redistribution of scraped content.
- No Madeira / Açores coverage in MVP.
- No "similar properties" suggestion across sources whose AGGREGATOR mode
  is disabled.
