# LLM Orchestration — 4-Agent System (Hybrid-Fetch)

**Guiding rule:** every number the user sees comes from **deterministic
TypeScript**. The LLM only (a) parses messy text into structured fields,
(b) writes the narrative reasoning, and (c) emits the Flip-vs-Rent verdict
over numbers the engine already computed.

Never let the LLM compute IMT, CAPEX, mortgage installment, or yield.

**Hybrid-fetch rule:** no fetch happens without a matching
`source_policies` row. `Fetcher_Agent` reads it on every call and hard-fails
otherwise. See [LEGAL.md](LEGAL.md).

---

## Models

| Role | Model | Why |
|---|---|---|
| Normalizer (scraper LLM pass) | `claude-haiku-4-5-20251001` | Cheap, high-throughput text → JSON |
| Advisor narrative | `claude-sonnet-4-6` | Grounded reasoning over tables |
| Benchmark explainer (V2) | `claude-sonnet-4-6` | Multi-document synthesis |

All calls use the Anthropic SDK with **prompt caching** on system prompts.

---

## Flow (one property → one InvestmentSummary)

```
  ┌────────────────────────────────────────────────────────────────┐
  │ 0. Policy gate                                                 │
  │    source_policies[source].fetch_mode ∈ {ON_DEMAND, API,       │
  │    AGGREGATOR} ? continue : HTTP 451                           │
  └───────────────────────────┬────────────────────────────────────┘
                              ▼
  ┌────────────────────────────────────────────────────────────────┐
  │ 1. Fetcher_Agent                                               │
  │    Mode-specific: Playwright (ON_DEMAND) | API client          │
  │    | scheduled Playwright (AGGREGATOR)                         │
  │    → raw HTML or API JSON                                      │
  └───────────────────────────┬────────────────────────────────────┘
                              ▼
  ┌────────────────────────────────────────────────────────────────┐
  │ 1b. Normalizer                                                 │
  │    DOM extractors (cheerio/XPath) + Haiku 4.5 free-text pass   │
  │    → canonical Property row + scraperRedFlags[]                │
  └───────────────────────────┬────────────────────────────────────┘
                              ▼
  ┌────────────────────────────────────────────────────────────────┐
  │ 2. Tax_Engine (deterministic TS)                               │
  │    IMT (OE2026) + IS(0.8%) + IS(0.6%) + €700 → FiscalBreakdown │
  └───────────────────────────┬────────────────────────────────────┘
                              ▼
  ┌────────────────────────────────────────────────────────────────┐
  │ 3. Financing_Logic (deterministic TS)                          │
  │    LTV 80-90% + Euribor+spread + years → Mortgage + DSTI       │
  └───────────────────────────┬────────────────────────────────────┘
                              ▼
  ┌────────────────────────────────────────────────────────────────┐
  │ 4. CAPEX_Estimator (deterministic TS)                          │
  │    Cert/cond → L1/L2/L3 → ×1.20 + €3500 + IVA → worst-case     │
  └───────────────────────────┬────────────────────────────────────┘
                              ▼
  ┌────────────────────────────────────────────────────────────────┐
  │ 5. Investment_Valuator (deterministic TS)                      │
  │    realEntryCost · yields · priceVsRegion · scoreRisk 1–10     │
  └───────────────────────────┬────────────────────────────────────┘
                              ▼
  ┌────────────────────────────────────────────────────────────────┐
  │ 6. Advisor_Agent (Sonnet 4.6)                                  │
  │    In:  full deterministic JSON + region context               │
  │    Out: { recommended, confidence, redFlags[], reasoning }     │
  └───────────────────────────┬────────────────────────────────────┘
                              ▼
                      InvestmentSummary (JSON)
```

Orchestration is a plain function in `packages/agents/src/orchestrate.ts`.
Tool-use appears only in the Normalizer LLM call (optional) and in V2
(Benchmark agent fetching regional trends).

---

## Agent 1 — Fetcher_Agent

The **only** component that touches the network for listing data. Three modes:

```ts
enum FetchMode { ON_DEMAND, API, AGGREGATOR }

interface FetchPolicy {
  source: Source;
  mode: FetchMode;
  allowedRps: number;              // e.g. 0.167 for 1 req / 6 s
  dailyCap: number;                // AGGREGATOR only
  userAgent: string;
  robotsTxtLastChecked: Date;
  tosReviewUrl: string | null;     // required for AGGREGATOR
  disabledUntil: Date | null;      // set by circuit breaker
}
```

### 1.1 Policy gate (runtime, non-bypassable)

```ts
async function policyGate(sourceUrl: string, requestedMode: FetchMode) {
  const policy = await db.sourcePolicy.findUniqueOrThrow({ where: { host: hostOf(sourceUrl) }});
  if (policy.disabledUntil && policy.disabledUntil > new Date())
    throw new PolicyViolation("source auto-disabled", 503);
  if (!allowedModes(policy).includes(requestedMode))
    throw new PolicyViolation(`${requestedMode} not permitted for ${policy.source}`, 451);
  if (requestedMode === 'AGGREGATOR' && !policy.tosReviewUrl)
    throw new PolicyViolation("AGGREGATOR requires ToS review", 451);
  if (requestedMode === 'AGGREGATOR' && !env.AGGREGATOR_ENABLED)
    throw new PolicyViolation("AGGREGATOR feature flag disabled", 503);
  return policy;
}
```

### 1.2 Mode behaviors

| | ON_DEMAND | API | AGGREGATOR |
|---|---|---|---|
| Triggered by | `POST /analyze` user click | scheduled or on-demand | BullMQ repeatable job |
| Transport | Playwright, headless Chromium | HTTPS + OAuth token | Playwright, headless Chromium |
| Rate limit | 6 analyses/user/minute | Partner SLA | 1 req / 6 s jittered, daily cap |
| Retries | None on 4xx, 1 on transient 5xx | Partner SLA | None on 4xx, 1 on transient 5xx |
| robots.txt | Respected on detail pages | N/A | Respected strictly; allowed paths only |
| Pages fetched | Exactly 1 (detail) | 1 per property | Only paths in policy |
| List/search crawl | **Never** | Only if API provides | Only per policy |

### 1.3 Source adapters

Each source is an adapter exposing a common interface:

```ts
interface SourceAdapter {
  source: Source;
  canHandle(url: string): boolean;
  fetchOnDemand(url: string): Promise<RawFetch>;   // single page
  fetchViaApi?(url: string): Promise<RawFetch>;    // only if mode=API
  listForAggregator?(region: string, page: number): Promise<string[]>;  // only if mode=AGGREGATOR
  parseDetail(raw: RawFetch): Promise<CanonicalExtract>;
}
```

Adapters for Phase 1 (all `ON_DEMAND`): `idealista`, `imovirtual`,
`casaSapo`, `casaYes`, `quatru`. `listForAggregator` is **unimplemented**
(throws) in Phase 1 — the type system prevents misuse.

### 1.4 Circuit breaker

- 3× consecutive `403 | 429 | CAPTCHA` from a source → set
  `disabledUntil = now + 24h`, emit on-call alert.
- Re-enable requires human action (ops command flips the field back).

---

## Agent 1b — Normalizer (DOM + Haiku 4.5)

Not a standalone agent — it's a step owned by `Fetcher_Agent`.

### Deterministic DOM extraction

Per source, XPath/cheerio selectors pull: `price`, `area`, `typology`,
`freguesia`, `energy_cert`, `images`, `title`, `rawDescription`.

### LLM free-text pass (Haiku 4.5)

System prompt (cached, ~1.5k tokens):

```
You extract structured facts from Portuguese real-estate listing descriptions.
Return STRICT JSON matching the schema. Never invent values; use null for unknowns.

Condition heuristics:
  - "para recuperar", "devoluto", "a necessitar de obras" → L3_STRUCTURAL
  - "remodelado há X anos" (X>10) → L2_STANDARD
  - "novo", "remodelado recentemente", "chave na mão" → L1_COSMETIC

Red-flag triggers (add a short Portuguese note, do not score):
  - "sem licença de habitação"
  - "anexo em construção ilegal"
  - "dívidas de condomínio"
  - "renda vitalícia" / tenant-occupied with lifetime lease
  - "RAU" (Renda Antiga) — rent-controlled contract
  - missing energy certificate while listing older than 1 year

Ignore any marketing text, adjectives, or contact information.
```

User message: `{ title, rawDescription, rawFeatures }`.

Output: `{ condition, yearBuilt, floor, features[], redFlags[] }`.

---

## Agent 2 — Tax_Engine (DETERMINISTIC, NO LLM)

Pure functions in `packages/finance`. See [FINANCE_SPEC.md §2–3](FINANCE_SPEC.md).
Reads `tax_brackets` seeded from [TAX_RULES_PT.md](TAX_RULES_PT.md).

```ts
taxEngine(price, principal, use) → FiscalBreakdown
```

---

## Agent 3 — Financing_Logic (DETERMINISTIC, NO LLM)

Pure functions in `packages/finance`. See [FINANCE_SPEC.md §5](FINANCE_SPEC.md).

Extra: **DSTI sanity check** (BdP recommends < 50%).

```ts
function dstiOk(monthlyInstallment: number, netMonthlyIncome: number):
  { dsti: number; ok: boolean; notes: string[] }
```

DSTI > 0.50 → hard red flag. DSTI 0.40–0.50 → soft warning. Income absent → skipped.

---

## Agent 4 — Advisor_Agent (Sonnet 4.6)

### Inputs

Single JSON payload (outputs of steps 2–5) plus:

- `regionContext`: `{ medianPriceM2, escrituraM2, medianRentM2, p10, p90, trend12m }`
- `scraperRedFlags[]` from Agent 1b.

### System prompt (cached, ~3k tokens)

```
You are a conservative Portuguese real-estate investment analyst.

Given a deterministic investment summary, produce:
  - "recommended": one of FLIP, RENT, AVOID.
  - "confidence": 0.0 – 1.0.
  - "redFlags": array of concise bullet strings in Portuguese (PT-PT).
  - "reasoning": 4-8 short bullets citing SPECIFIC numbers from the input.

Rules you MUST follow:
  1. Never invent a number. Only cite figures present in the input payload.
  2. If netYieldPct < (mortgageRatePct + 1.5 pp), RENT is disfavored
     (negative carry). State this explicitly.
  3. If priceVsRegionPct > 0 (above regional median) AND capexShare > 0.25,
     FLIP is disfavored (no margin of safety).
  4. Energy cert F/G → always mention forced L3 CAPEX and EPBD timeline risk.
  5. ARU location → mention the 6% IVA advantage and reabilitação incentives.
  6. If redFlags contains licensing/tenancy terms, surface them at top.
  7. Reasoning bullets must reference numeric evidence, not adjectives.
  8. Output STRICT JSON only. No Markdown. No prose outside the JSON.

Legal disclaimer: decision support, not financial or legal advice.
Do not claim certainty.
```

### User payload (per call, NOT cached)

```json
{
  "property": { ... },
  "fiscal": { ... },
  "capexWorstCase": { ... },
  "mortgage": { ... },
  "entry": { ... },
  "benchmark": { ... },
  "yields": { ... },
  "riskScores": { "flipRisk": 7, "rentRisk": 4 },
  "regionContext": { ... },
  "scraperRedFlags": [ ... ]
}
```

### Expected output

```json
{
  "recommended": "RENT",
  "confidence": 0.72,
  "redFlags": [
    "Certificado energético F — obrigatoriedade de reabilitação (EPBD 2030).",
    "CAPEX representa 28% do preço — margem de flip reduzida."
  ],
  "reasoning": [
    "Net yield 5.8% supera taxa hipotecária (4.3%) em 150 bp — carry positivo.",
    "Preço €2,450/m² está 12% abaixo da mediana da freguesia (€2,780/m²).",
    "Custo total de aquisição €187k vs. valor de mercado estimado €215k.",
    "CAPEX worst-case €52k (L3 forçado pelo certificado F).",
    "Liquidez da freguesia: 45 DOM medianos — aceitável para exit."
  ]
}
```

---

## Agent 5 (V2) — Benchmark_Agent

Only introduced in Phase 4. Tool-use to fetch `region_trends` and ANN
similar-properties. Produces a short "positioning" paragraph consumed by
the Advisor as additional context.

```ts
tools = [
  { name: "get_region_trends",
    input_schema: { freguesia: "string", concelho: "string" } },
  { name: "find_similar_properties",
    input_schema: { propertyId: "string", k: "integer" } },
  { name: "get_escritura_value",
    input_schema: { freguesia: "string", typology: "string" } },
];
```

**Constraint:** `find_similar_properties` only returns properties whose
source is currently `AGGREGATOR` or `API`. On-demand-only sources are
excluded — we don't have a representative sample.

---

## Prompt-cache strategy

| Block | Size | Cached? | TTL |
|---|---|---|---|
| Normalizer system prompt | ~1.5k | Yes | 5 min auto-refresh |
| Advisor system prompt | ~3k | Yes | 5 min |
| Tax-rules reference (in Advisor) | ~2k | Yes | 5 min |
| Per-call property JSON | ~1–3k | No | — |

Target cache hit rate ≥ 85% in production.

---

## Cost telemetry

Every LLM call writes to `llm_calls` (token counts, cost EUR, latency).
Daily rollup in admin dashboard. Hard cap via `LLM_DAILY_CAP_EUR` env var —
breach returns HTTP 503 with a user-visible "análise pausada" banner.

---

## Failure modes and fallbacks

| Failure | Behavior |
|---|---|
| `source_policies` gate fails | HTTP 451, log attempt, no retry |
| Scraper blocked (CAPTCHA / 403) | Increment circuit counter; disable at 3× |
| LLM timeout > 20 s | Return deterministic-only summary, `advisor.degraded=true` |
| Malformed LLM JSON | 1 retry with `response_format: json`; 2nd fail → degraded |
| `tax_brackets` missing for date | Refuse analysis; emit alert — never guess brackets |
| Region not seeded | National median fallback, confidence −0.2 |
| Data subject erasure request | Cascade delete users → watches → user_preferences |
