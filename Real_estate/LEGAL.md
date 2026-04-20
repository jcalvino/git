# Legal & Compliance Posture

This document is the **operational** legal posture for the platform. Not
legal advice. Before any public launch, have a PT lawyer review this file
and each `docs/tos-reviews/<source>-<YYYY-MM-DD>.md` artifact.

---

## 1. Legal frame (EU + PT)

| Instrument | What it gives / restricts |
|---|---|
| **EU Directive 96/9/EC** (Database Directive, *sui generis* right) | Listings DBs are likely protected. Large-scale extraction can infringe even without copying text verbatim. |
| **CDADC (PT Copyright Code)** | Photos and descriptive text on listings are copyrightable. |
| **GDPR / RGPD + Lei 58/2019** | Names, phone numbers, e-mails of anunciantes are personal data. Processing needs a lawful basis and minimization. |
| **DL 47/2013** (Concorrência Desleal) | Systematic free-riding on another operator's commercial effort can be unfair competition. |
| **Each source's ToS** | Contractual overlay; violation = breach of contract even where law is permissive. |
| **robots.txt** | Not legally binding in PT, but material evidence of bad faith if ignored. |

**Posture:** treat all sources as protected databases. Only fetch with a
defensible justification per request: user-initiated (ON_DEMAND), contractual
(API), or narrow + respectful + ToS-reviewed (AGGREGATOR).

---

## 2. Per-source posture

Each source has a seeded row in `source_policies` ([SCHEMA.md §1.5](SCHEMA.md)).
Status here is **initial**; re-review quarterly.

### 2.1 Idealista — `https://www.idealista.pt/`

| Field | Value |
|---|---|
| Phase 1 mode | `ON_DEMAND` |
| Target mode | `API` (Partner, B2B) |
| robots.txt | Disallows `/*?` query variants; allows detail pages |
| ToS | Prohibits scraping, automated collection, redistribution |
| Anti-bot | DataDome, IP reputation, TLS fingerprinting |
| Public API | No. Partner API exists — requires B2B application |
| Known enforcement | Public litigation in Spain against scrapers; active legal team |
| Action | Submit Partner API application **Phase 2 week 1**. No AGGREGATOR crawling at any point without API access. |

### 2.2 Imovirtual — `https://www.imovirtual.com/`

| Field | Value |
|---|---|
| Phase 1 mode | `ON_DEMAND` |
| Target mode | `ON_DEMAND` (AGGREGATOR blocked by protection) |
| robots.txt | Allows detail pages; disallows listing/search AJAX endpoints |
| ToS | Prohibits scraping and data collection |
| Anti-bot | Cloudflare challenge, bot detection |
| Public API | None |
| Action | Stay `ON_DEMAND`. If partner program appears, pursue. No bulk crawling. |

### 2.3 Casa SAPO — `https://casa.sapo.pt/`

| Field | Value |
|---|---|
| Phase 1 mode | `ON_DEMAND` |
| Target mode | `AGGREGATOR` (candidate — requires ToS review) |
| robots.txt | Relatively permissive on detail pages |
| ToS | Prohibits automated collection; but enforcement historically softer |
| Anti-bot | Minimal |
| Public API | None documented |
| Action | Phase 3 candidate for `AGGREGATOR` with 1 req / 6 s, only after `docs/tos-reviews/casasapo-YYYY-MM-DD.md` is signed off. |

### 2.4 CasaYes — `https://casayes.pt/pt`

| Field | Value |
|---|---|
| Phase 1 mode | `ON_DEMAND` |
| Target mode | `AGGREGATOR` (candidate) |
| robots.txt | Permissive |
| ToS | Standard "personal use only" clause |
| Anti-bot | None detected |
| Public API | None |
| Action | Phase 3 candidate; lower traffic footprint than Idealista/Imovirtual. |

### 2.5 Quatru — `https://quatru.pt/`

| Field | Value |
|---|---|
| Phase 1 mode | `ON_DEMAND` |
| Target mode | `AGGREGATOR` (candidate) |
| robots.txt | Permissive |
| ToS | Standard terms |
| Anti-bot | None detected |
| Public API | None |
| Action | Phase 3 candidate. |

---

## 3. ON_DEMAND mode — why it is defensible

| Property | Value |
|---|---|
| Trigger | Explicit user click on the user's own browser session |
| Fetch count | **Exactly one** HTTP request per URL (plus images referenced inline) |
| Retention | Raw HTML purged after **30 days** |
| Rate limit | Bounded by human click rate (the API throttles to 1 req/user/10s) |
| Data shown | Already visible to the user in their browser |
| Persistence | Derived analysis stored; raw scraped content anonymized before long-term retention |

This mirrors how a browser extension or a human using the site behaves.
Courts and DPAs have consistently treated single-URL, user-initiated
fetches differently from systematic crawling.

**Hard rules for ON_DEMAND**:
- No crawling of list/search pages, ever.
- No iteration over `page=2…N`.
- No pre-fetching "similar properties" from the same source.
- User-agent identifies the tool honestly (no impersonation).
- Honour `Retry-After` headers; no retries on 4xx.

---

## 4. AGGREGATOR mode — gating checklist

Before a source's `fetch_mode` can be set to `AGGREGATOR`:

- [ ] Signed-off `docs/tos-reviews/<source>-<date>.md` (must cite exact ToS clauses).
- [ ] `robots.txt` reviewed and paths restricted to allowed sections.
- [ ] Rate limit set to **≤ 1 req / 6 s, jittered** per source.
- [ ] Daily volume cap (< 2,000 requests/day per source, MVP).
- [ ] No login, no cookies, no session reuse — stateless fetches only.
- [ ] Honest `User-Agent`: `RealEstateInvestmentAnalyzer/1.0 (+contact)`.
- [ ] Content is **not redistributed** — only the derived analysis is exposed.
- [ ] Per-listing link-through remains prominent — we drive traffic to the source.
- [ ] Feature flag `AGGREGATOR_ENABLED=true` in environment.
- [ ] Legal review (PT counsel) within last 12 months.

Any ❌ → stays `ON_DEMAND`.

---

## 5. GDPR / RGPD

### 5.1 Personal data in listings
- **Seller / agency contacts** (name, phone, email) are personal data.
- MVP **does not store** seller contact details. Adapter strips them in the normalizer.
- If a future module needs them, lawful basis = legitimate interest, with DPIA.

### 5.2 Platform users
- **Data controller:** the platform operator.
- **Data collected:** email (magic-link auth), watchlist, preference vector.
- **Retention:** account lifetime + 30 days.
- **Rights:** access / rectification / erasure / portability exposed in the UI.
- **DPO:** required if processing scales beyond hobby use.

### 5.3 Data subject requests
- Contact email published in UI footer.
- 30-day response SLA.
- Erasure cascades: `users` → `watches` → `user_preferences`.

---

## 6. Retention policy

| Data | Retention | Rationale |
|---|---|---|
| Raw HTML (ON_DEMAND) | 30 days | Debugging; then purge |
| Raw HTML (AGGREGATOR) | 90 days | Re-processing window |
| `properties` (canonical) | Indefinite while `active=true` | Core product |
| `properties` after delisting | 18 months → anonymize | Trend history |
| `property_snapshots` | 3 years | Price-trend analytics |
| `analyses` | Indefinite | User can audit their decisions |
| `llm_calls` | 12 months | Cost analytics only; no payloads |
| User account data | Account lifetime + 30 days | GDPR |

Enforcement: nightly Prisma job `packages/db/src/retention.ts`.

---

## 7. Disclaimers (rendered in UI)

Every analysis view must include:

> Esta análise é uma ferramenta de apoio à decisão, **não constitui
> aconselhamento financeiro, fiscal ou jurídico**. Valores de IMT, IS, IMI
> e CAPEX são estimativas baseadas em tabelas públicas e em premissas
> conservadoras. Antes de qualquer decisão de compra ou financiamento,
> confirme os valores junto de um contabilista certificado, advogado e da
> sua instituição financeira. O Valor Patrimonial Tributário (VPT) real
> pode divergir do estimado e altera a base de IMI.

Fiscal section adds:

> Cálculo de IMT com base nas tabelas OE2026 (HPP / Investimento). Verifique
> a validade das tabelas à data da escritura em www.portaldasfinancas.gov.pt.

---

## 8. Incident response

| Event | Response |
|---|---|
| C&D / takedown from a source | Immediately disable that source in `source_policies`; purge `properties` from that source within 7 days; reply via legal counsel |
| 3× consecutive 403 / CAPTCHA from a source | Auto-disable `source_policies` row; on-call alert |
| Data subject request | Acknowledge within 72h; execute within 30 days |
| Data breach | 72h notification to CNPD (Comissão Nacional de Proteção de Dados) |

---

## 9. Review cadence

| Artifact | Cadence | Owner |
|---|---|---|
| This file (LEGAL.md) | Quarterly | Product owner |
| `source_policies` | Quarterly | Product owner |
| `docs/tos-reviews/*` | Annually per source | PT legal counsel |
| Retention job execution | Weekly (ops dashboard) | On-call |
| IMT tables refresh | Annually (Jan) | Tax_Engine owner |
