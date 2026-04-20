# Portugal Real Estate Investment Platform — Hybrid-Fetch

AI-powered investment analyst for **Portugal Continental**.
**Legal posture first:** no mass scraping in MVP. Three fetch modes, used
in sequence by phase:

| Mode | What | Legal defensibility | Phase |
|---|---|---|---|
| **ON_DEMAND** | User pastes a URL → 1 fetch, no persistence beyond the analysis | High — mimics human behavior | **1 (MVP)** |
| **API** | Idealista Partner API (B2B, approval required) | Highest — contractual | 2+ (parallel application) |
| **AGGREGATOR** | Scheduled crawls, dedup, watchlists | Medium — only on permissive sources, with rate limits | 3 (gated) |

The deterministic fiscal/CAPEX engine ([FINANCE_SPEC.md](FINANCE_SPEC.md))
and the OE2026 tax tables ([TAX_RULES_PT.md](TAX_RULES_PT.md)) are the
same across all three modes.

## Documents (read in this order)

1. [LEGAL.md](LEGAL.md) — per-source legal posture, GDPR, retention. **Read first.**
2. [STACK.md](STACK.md) — tech stack and directory layout.
3. [SCHEMA.md](SCHEMA.md) — PostgreSQL + pgvector data model.
4. [TAX_RULES_PT.md](TAX_RULES_PT.md) — exact IMT/IS/IMI/ARU rules (OE2026).
5. [FINANCE_SPEC.md](FINANCE_SPEC.md) — deterministic formulas and worked examples.
6. [AGENTS.md](AGENTS.md) — 4-agent orchestration with FetchPolicy gating.
7. [ROADMAP.md](ROADMAP.md) — hybrid-fetch phased delivery.
8. [HOTEL_ROOM_INVESTMENT.md](HOTEL_ROOM_INVESTMENT.md) — asset-class extension: condohotel / aparthotel analysis, risks, platform changes.

## Data sources & fetch policy (MVP)

| Source | URL | Policy (Phase 1) | Target policy |
|---|---|---|---|
| Idealista | https://www.idealista.pt/ | **ON_DEMAND only** | API (Partner) |
| Imovirtual | https://www.imovirtual.com/ | **ON_DEMAND only** | ON_DEMAND (aggregator blocked — Cloudflare) |
| Casa SAPO | https://casa.sapo.pt/ | ON_DEMAND | AGGREGATOR (Phase 3, if ToS permits) |
| CasaYes | https://casayes.pt/pt | ON_DEMAND | AGGREGATOR (Phase 3) |
| Quatru | https://quatru.pt/pt/comprar/apartamento/moradia | ON_DEMAND | AGGREGATOR (Phase 3) |

`source_policies` table ([SCHEMA.md](SCHEMA.md) §1.5) is the single
runtime switch that gates every fetch — **no source is scraped unless its
row allows it**.

## Invariants (unchanged)

- Portugal Continental only (Madeira / Açores excluded).
- Always worst-case CAPEX: 1.20× contingency + €3,500 licensing + IVA.
- Forced L3 structural when Energy Cert ∈ {F, G}.
- 28% flat tax on rental income for Net Yield.
- Every number is deterministic TS; LLM only writes narrative + verdict.

## New invariants (hybrid fetch)

- **No fetch without a matching `source_policies` row.** Hard-fail at runtime.
- **`ON_DEMAND` never queues, never schedules.** Exactly one fetch per user click.
- **`AGGREGATOR` requires a feature flag** (`AGGREGATOR_ENABLED=true`) **and**
  a written ToS review checked into `docs/tos-reviews/<source>-<date>.md`.
- **Rate limits are policy-enforced** (not just best-effort code).
- Raw HTML is retained 30 days for on-demand, 90 days for aggregator, then
  purged. Derived financial analyses are kept indefinitely.
- Any source returning 403/CAPTCHA 3× consecutively is **auto-disabled**
  in `source_policies` — requires manual re-enable.

## Hybrid architecture

```
 ┌────────────────── USER ─────────────────────┐
 │  Paste URL  │  Dashboard  │  Watchlist(V3)  │
 └──────┬──────┴──────┬──────┴────────┬────────┘
        ▼             ▼               ▼
  ┌───────────┐ ┌───────────┐   ┌───────────┐
  │ ON_DEMAND │ │ DB read   │   │ AGGREGATOR│
  │ fetcher   │ │ (cached)  │   │ (gated)   │
  └─────┬─────┘ └─────┬─────┘   └─────┬─────┘
        │             │               │
        │  ┌──────────┴───────────┐   │
        │  │   source_policies    │◄──┘   ← runtime gate
        │  └──────────┬───────────┘
        ▼             │
  ┌────────────────────────────────────┐
  │ Fetcher_Agent  (Playwright | API)  │
  │  enforces: rps, robots.txt, 403→off│
  └──────────────┬─────────────────────┘
                 ▼
  ┌────────────────────────────────────┐
  │ Normalizer  (Haiku 4.5)            │
  └──────────────┬─────────────────────┘
                 ▼
  ┌────────────────────────────────────┐
  │ Deterministic Engine               │
  │ Tax · Financing · CAPEX · Valuator │
  └──────────────┬─────────────────────┘
                 ▼
  ┌────────────────────────────────────┐
  │ Advisor_Agent  (Sonnet 4.6)        │
  │ → risk 1-10, red flags, verdict    │
  └──────────────┬─────────────────────┘
                 ▼
         InvestmentSummary (JSON)
```

## Disclaimer

Decision-support tool. Not financial, legal, or tax advice. Always confirm
fiscal figures with a certified contabilista / advogado before any transaction.
