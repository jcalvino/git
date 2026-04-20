# Hotel Room Investment — Portugal (Aparthotel / Condohotel)

Research + investment framework for the asset class "comprar um quarto
de hotel para investir". Specific to Portugal Continental. This document
is a **product extension** for the platform: it adds a new property type
(`HOTEL_UNIT`), a different revenue model, and different fiscal rules.

> Sources: DL 39/2008 (RJET), DL 56/2023 (Mais Habitação), CIRS, CIVA,
> INE Turismo series, Confidencial Imobiliário, operator prospectuses
> (Pestana, Vila Galé, Hilton, Marriott, Myriad, Four Seasons Fairways,
> NAU Hotels). Figures below are typical ranges as of 2025–2026; every
> concrete deal must be re-quoted from the vendor's prospecto.

---

## 1. What the asset actually is

Legally, you are **not** buying "a hotel room". You are buying:

- A **fração autónoma** (autonomous unit) of an
  **empreendimento turístico em propriedade plural** — a touristic
  development registered under DL 39/2008.
- The unit has its own **matriz predial** (article in the fiscal register)
  and its own title in the **Conservatória do Registo Predial**.
- Every owner is mandatorily bound by a **contrato de exploração turística**
  with the hotel operator for a long period (typically 10–20 years,
  renewable). This is **not optional** — it is registered against the unit.

Common categories (same legal regime, different product):
- **Hotel-apartamento** / **aparthotel** — most common for investment (studios, T0, T1).
- **Aldeamento turístico** — resort-style, often golf/Algarve.
- **Apartamento turístico** — lower category, frequently long-stay.
- **Condohotel** — marketing term for the investment variant of the above;
  not a legal category.

**Key legal constraint:** the unit is part of a turismo asset. It cannot
be converted to standard residential use, nor let under a common rental
contract, without changing the empreendimento's classification — which
requires the operator's consent and Turismo de Portugal approval.

---

## 2. Typical deal structure

| Element | Typical range |
|---|---|
| Unit size | 22 – 55 m² (studio to T1) |
| Ticket size | €180k – €550k (Lisboa/Porto/Algarve premium); €120k – €220k (secondary) |
| **Yield guarantee period** | 5 – 10 years |
| **Guaranteed yield (contract)** | 4% – 6% of purchase price, annual |
| Payment frequency | Quarterly or semi-annual |
| Post-guarantee | Revenue-share: owner typically gets **30% – 50%** of room revenue, net of operator opex |
| Owner personal use | 2 – 4 weeks/year, **off-peak only**, subject to availability |
| Exit restriction | Often first-right-of-refusal to developer/operator; sometimes a full lock-up for N years |
| Branded operators (PT) | Pestana, Vila Galé, NAU, Hoti Hotéis, Myriad, Tivoli (Minor), Marriott, Hilton, Accor |

**Read the prospecto carefully** for: operator default clauses, FF&E
replacement reserve (who funds refurb), escalation clauses on guarantee,
secondary-market rules.

---

## 3. Acquisition costs — same engine, different inputs

### 3.1 IMT

**Always INVESTMENT bracket** (never HPP — the unit cannot be primary residence).
See [TAX_RULES_PT.md §1.2](TAX_RULES_PT.md).

### 3.2 IS — Stamp duty

- Acquisition: **0.8% × price** (same as residential).
- Mortgage: **0.6% × principal** (same).

### 3.3 VAT / IVA — the key difference

- **New-build tourism units: 23% IVA** embedded in the developer's price.
  Unlike residential, ARU reduction to 6% **does not apply** to tourism
  new-builds — the reduced rate is for habitação própria reabilitation.
- Buyers who are **not VAT-registered** (pessoas singulares investidoras
  comuns) pay VAT-inclusive and **cannot recover it**.
- Buyers who register under Cat B (IRS empresarial) can recover VAT but
  must charge VAT on the yield they receive → significant compliance
  overhead. Mostly done by funds and holding companies, not individuals.

**Platform assumption:** investor is a singular person, VAT non-recoverable,
purchase price is VAT-inclusive. IMT calculated on VAT-inclusive price.

### 3.4 Financing

Banks treat tourism units as **commercial collateral**, not residential.

| Factor | Residential | Hotel unit |
|---|---|---|
| Max LTV | 80–90% | **60–70%** |
| Spread over Euribor | 0.60–1.20 pp | **1.50–2.50 pp** |
| Term | 25–40 y | **15–25 y** |
| DSTI ceiling | 50% | **same** |

Many developers arrange pre-approved financing with a partner bank
(often at worse-than-market terms — read the quote carefully).

### 3.5 Notary + registration

Same €700 assumption as residential. Verify for high-value units
(>€400k often carries higher fees due to more complex document chain).

### 3.6 Fixed costs unique to this asset class

- **Entrada no condomínio turístico**: one-off €500 – €2,000 for the unit's
  share of common-area FF&E fund.
- **Taxas de Turismo de Portugal** (registo empreendimento) — typically
  paid by developer; confirm.
- **Legal review** of contrato de exploração — €500 – €1,500. Non-optional
  in practice; never sign a 10-year binding contract without one.

---

## 4. Revenue model — two regimes stacked

### 4.1 Years 1 – N: Guaranteed yield

```
GrossYield_Annual = Price × guaranteedPct       # e.g. 280,000 × 0.05 = 14,000
```

- Paid regardless of hotel performance (contractual).
- Usually **net of operator opex and condo expenses** — owner receives
  a "pure" number quarterly/semi-annually.
- **Critical caveat:** the developer frequently **prices the guarantee into
  the asking price**. A unit "worth" €250k at market is sold for €280k
  with a 5% guarantee — €14k/y for 5 years = €70k, which is ≈ the price
  premium. The investor is largely being returned their own capital.

### 4.2 Years N+1: Revenue-share (real exposure begins)

Typical formula:

```
OwnerRevenue = (RoomRevenue − OperatorFee − CondoOpex − FFEReserve) × OwnerShare
```

Where:
- `OperatorFee` = 8% – 15% of gross room revenue.
- `CondoOpex` = cleaning, utilities, front-desk allocation — often
  20% – 30% of gross.
- `FFEReserve` = 3% – 5% of gross for refurb every 7–10 years.
- `OwnerShare` = typically **30% – 50%** of what remains.

Typical pro forma (studio, Lisboa city centre, €180 ADR, 70% occupancy):

| Line | Annual |
|---|---|
| Gross room revenue (365 × 0.70 × €180) | €45,990 |
| − VAT (6% on tourism accommodation) | −€2,603 |
| Net gross | €43,387 |
| − Operator fee (12%) | −€5,206 |
| − Condo opex (25%) | −€10,847 |
| − FF&E reserve (4%) | −€1,735 |
| **Distributable** | **€25,599** |
| × Owner share (40%) | **€10,240** |

On a €280k purchase → **3.66% gross post-guarantee**. This is typically
**below** the guaranteed rate — a common post-guarantee drop.

---

## 5. Recurring costs

| Item | Range | Notes |
|---|---|---|
| Condomínio turístico | €60 – €200/month | Usually deducted from yield before payout |
| IMI (often "serviços" rate) | 0.3% – 0.45% of VPT | VPT ≈ 70% of price; often the unit is classified as "serviços" not "habitação" → can be at **higher rate** (0.8% max in some municipalities) |
| Seguro multirriscos | €150 – €300/y | Often bundled into condomínio |
| Manutenção FF&E (pós-garantia) | 3%–5% of gross | Either reserve-based or ad-hoc |
| Refurb "soft" (every ~7 y) | €4k – €8k / studio | Sometimes the reserve covers it; sometimes not |
| Refurb "heavy" (every ~15 y) | €15k – €30k / studio | Almost always a fresh capital call |

---

## 6. Tax treatment on the income

Owner receives yield → normally **Categoria F** (rendimentos prediais)
for personal taxpayers → **28% flat** (taxa liberatória) — same as the
residential rental assumption in [TAX_RULES_PT.md §5](TAX_RULES_PT.md).

Edge cases:
- If the unit is registered as **Alojamento Local** under the owner's name
  (rare in condohotel), income is **Categoria B** (empresarial) with
  simplified regime (35% of revenue taxed as income if turismo accommodation).
- If owner operates through a company (**SNC tax = 21% IRC + derrama**),
  profits taxed at company level + 28% on dividends — dual layer.

**Platform assumption for MVP:** investor is individual, income is
**Cat F at 28%** — same formula works, same `netRent × 0.72`.

### 6.1 IVA on the yield paid to owner

The operator charges guests 6% IVA on accommodation; this is their problem,
not the owner's. Owner receives a **VAT-free** distribution because they
are not the service provider. Unless owner has elected Cat B + VAT regime.

### 6.2 Mais-valias on sale

- Full gain taxed; **50% of the gain** enters IRS taxable base at marginal
  rates for residents.
- Non-residents: **28% flat on 50% of gain** (or marginal, more complex).
- **No reinvestment exemption** — that applies only to HPP sales.

---

## 7. Golden Visa note (post-Mais Habitação)

Relevant for some investor profiles:

- **Since October 2023 (DL 56/2023)**: real estate investment — **including
  condohotel** — is **no longer** a Golden Visa pathway.
- Remaining paths: capital transfer (€1.5M), investment funds (€500k,
  excluding real estate exposure), R&D, job creation, cultural heritage.
- Conclusion: **condohotel no longer confers residency rights**. Any
  promotional material implying otherwise is misleading.

---

## 8. Advantages — the honest list

| # | Advantage | Strength |
|---|---|---|
| 1 | **Zero tenant management** — operator handles everything | Real |
| 2 | Guaranteed yield during contract years | Real, but see §4.1 caveat |
| 3 | Professional, branded operation — high occupancy, premium ADR | Real in top 3 cities / Algarve |
| 4 | Turnkey from day one — no reno risk | Real (new-build only) |
| 5 | Exposure to Portuguese tourism growth (10M+ visitors/y, rising ADR) | Real but cyclical |
| 6 | Some personal use included | Limited — usually off-peak, bookable ahead |
| 7 | Prime locations that a residential investor couldn't afford alone | Real (e.g. a suite in Chiado or Douro) |
| 8 | Currency diversification for non-EUR investors | Real |

---

## 9. Disadvantages — the honest list

| # | Disadvantage | Severity |
|---|---|---|
| 1 | **Very low liquidity.** Secondary market is thin; resale often requires operator consent and can trade at 10%–25% discount | 🔴 High |
| 2 | Long lock-in to the exploitation contract (10–20 y); terminating early usually impossible or very costly | 🔴 High |
| 3 | **Guaranteed yield frequently priced into the sticker price** → not "free" return | 🔴 High |
| 4 | Post-guarantee revenue share can **drop materially** (§4.2 shows ≈3.7% vs. promised 5%) | 🟠 Material |
| 5 | Operator dependency — if the operator defaults or the hotel closes, unit value can collapse | 🔴 High (tail risk) |
| 6 | **No ARU 6% IVA advantage** — full 23% VAT on new-build | 🟠 Material |
| 7 | Financing worse than residential: lower LTV (60%–70%), higher spread | 🟠 Material |
| 8 | **Golden Visa pathway removed** in 2023 | 🟡 Context-dependent |
| 9 | Capital calls for refurb every 7–15 years (not always covered by reserve) | 🟠 Material |
| 10 | Cannot be converted to long-term rental or HPP without reclassification | 🟡 Design |
| 11 | **Highly cyclical** — COVID-style shocks hit revenue-share immediately; guarantee can survive one cycle but not two | 🔴 High |
| 12 | Personal use severely restricted — not the "second home" it is sometimes marketed as | 🟡 Design |
| 13 | IMI often at commercial rate (up to 0.8%) — higher than residential | 🟡 Material |
| 14 | FX / macro: Portuguese tourism depends on UK, DE, FR, NL, US demand | 🟡 Context |

---

## 10. Risk matrix — hotel unit vs. standard buy-to-let

Scored 1 (low) to 10 (high) on each axis. Rough illustrative values —
Advisor agent should recompute per deal.

| Axis | Residential BtL | Hotel unit |
|---|---|---|
| Cashflow predictability | 4 | **3 during guarantee / 7 after** |
| Liquidity on exit | 5 | **9** |
| Operator / counterparty risk | 2 | **8** |
| Regulatory risk | 6 (Mais Habitação, RAU risk) | **5** |
| Macro / cyclical risk | 5 | **8** |
| Tenant / vacancy risk | 6 | 2 (operator handles) |
| CAPEX surprise risk | 5 | **7** (forced refurb cycle) |
| Tax complexity | 3 | 6 (if not pure Cat F) |
| Financing risk | 3 | **7** (narrower pool of banks) |
| Legal / contractual risk | 3 | **8** (contrato exploração binding) |
| **Composite (simple avg)** | **4.2** | **6.3** |

**Reading:** the hotel unit is a **higher-risk, more passive** product.
Its selling point is convenience and brand, not yield. If the guaranteed
yield (net of all costs) is not clearly above residential buy-to-let
plus ~200 bp, the deal is not paying for the extra risk.

---

## 11. Worked example — studio at €280,000 in Lisboa

Inputs:
- Price €280,000, area 35 m², tourism new-build, VAT-inclusive.
- Financing: LTV 70%, rate 5.2% (Euribor 12M 2.7% + spread 2.5), 20 years.
- Guaranteed yield 5% for 7 years, then revenue-share (40% owner).
- Location: Santa Maria Maior, Lisboa (prime, typical ADR €180, occ. 70%).

### 11.1 Acquisition cost

| Item | Value (EUR) |
|---|---|
| Price | 280,000.00 |
| **IMT** (INVESTMENT, bracket 4) `280k × 0.07 − 9,394.50` | 10,205.50 |
| **IS acquisition** `280k × 0.008` | 2,240.00 |
| **IS mortgage** `196k × 0.006` | 1,176.00 |
| Notary + setup | 700.00 |
| Entrada no condomínio turístico (avg) | 1,000.00 |
| Legal review of contrato | 1,000.00 |
| **Total acquisition cost** | **296,321.50** |
| Downpayment (30%) | 84,000.00 |
| Mortgage principal (70%) | 196,000.00 |
| **Real entry cost (cash)** | **100,321.50** |

### 11.2 Year 1 – 7 (guarantee)

| Item | Annual (EUR) |
|---|---|
| Guaranteed yield `280k × 0.05` | 14,000.00 |
| − IRS 28% (Cat F) | −3,920.00 |
| − IMI (est. 0.45% × 0.7 × 280k) | −882.00 |
| **Net cash from yield** | **9,198.00** |
| − Mortgage installment (12 × €1,311) | −15,732.00 |
| **Net annual cashflow (cash-on-cash)** | **−€6,534.00** |

With 70% LTV and 5% yield the **carry is negative by ≈€545/month**.
This is the typical picture — the deal only works on appreciation + the
"guarantee buys me calm" thesis, **not** on cashflow.

### 11.3 Year 8+ (revenue share, §4.2 pro forma)

Owner revenue ≈ **€10,240/y gross** → net 72% = €7,373 after IRS − IMI
€882 = **€6,491 net cash**. Versus same mortgage (€15,732) → **−€9,241/y
carry**. The "growth" story hinges on capital appreciation more than income.

### 11.4 Yields summary

| Metric | Year 1–7 | Year 8+ |
|---|---|---|
| Gross yield on price | 5.00% | 3.66% |
| Net yield on total acq cost | 3.10% | 2.19% |
| Cash-on-cash on real entry | −6.51% | −9.21% |
| Break-even without mortgage | **Yes** — if bought cash | Marginal |

### 11.5 Verdict — what the platform would say

- **Recommended: AVOID** for a leveraged investor seeking cashflow.
- **Recommended: RENT (hold)** for a cash buyer (≥ €300k liquid) seeking
  a **passive dollar-cost-averaged exposure to Portuguese tourism with
  some personal use**, and only if the **post-guarantee pro forma** still
  beats a conservative BtL benchmark.
- Confidence 0.7 — operator default is the unknowable risk.

---

## 12. Platform extension — what changes

To support this asset class in the existing engine:

### 12.1 New enum values

```prisma
enum PropertyType {
  RESIDENTIAL_APARTMENT   // default, today's MVP
  RESIDENTIAL_HOUSE
  HOTEL_UNIT              // new
  TOURIST_APARTMENT       // alojamento local standalone
  COMMERCIAL              // reserved for future
}

enum RevenueModel {
  LONG_TERM_RENTAL        // default
  GUARANTEED_THEN_SHARE   // condohotel
  SHORT_TERM_AL           // owner-operated Alojamento Local
  MIXED                   // e.g. seasonal
}
```

Add to `Property`: `propertyType`, `revenueModel`,
`operator` (nullable), `guaranteeYieldPct` (nullable),
`guaranteeEndsOn` (nullable), `ownerSharePostGuarantee` (nullable).

### 12.2 Finance engine additions — `packages/finance/src/hotel.ts`

```ts
interface HotelDealTerms {
  guaranteedPct: number;             // 0.05
  guaranteeYears: number;            // 7
  postGuaranteeOwnerShare: number;   // 0.40
  adrEUR: number;                    // 180
  occupancyPct: number;              // 0.70
  operatorFeePct: number;            // 0.12
  condoOpexPct: number;              // 0.25
  ffeReservePct: number;             // 0.04
  tourismVatPct: number;             // 0.06
}

function hotelRevenueStream(
  price: number,
  terms: HotelDealTerms,
  years: number,
): { year: number; gross: number; net: number; regime: "GUARANTEE" | "SHARE" }[];
```

### 12.3 Fiscal rules — augment [TAX_RULES_PT.md](TAX_RULES_PT.md)

- Force `use = INVESTMENT` (never HPP).
- IVA: assume VAT-inclusive, no recovery, no ARU discount on tourism.
- IMI: if municipality flags unit as "serviços", use higher rate
  (seed per concelho; default 0.45%).
- IRS: Cat F 28% flat unchanged.

### 12.4 Financing policy — augment `packages/finance/src/mortgage.ts`

- Max LTV = 70% for `propertyType == HOTEL_UNIT` (hard clamp).
- Min spread = 1.50 pp over Euribor (default input).
- Max term = 25 y.

### 12.5 Risk scorer — new weights for hotel units

Add to `packages/finance/src/risk.ts`:

```ts
const HOTEL_RISK_WEIGHTS = {
  liquidityDiscount: 0.15,            // +1.5 points baseline
  operatorConcentration: 0.20,        // single-operator dependency
  guaranteeExpiryRisk: 0.10,          // ramp as expiry approaches
  refurbCycleRisk: 0.05,
  negativeCarry: 0.20,                // if cashOnCash < 0
};
```

### 12.6 Advisor prompt additions — [AGENTS.md](AGENTS.md) §4

Extra rules in the system prompt when `property.propertyType == HOTEL_UNIT`:

```
9.  If property is HOTEL_UNIT, always check: (a) is the guaranteed yield
    net of costs? (b) does the post-guarantee pro forma still beat a
    residential BtL benchmark by ≥ 150 bp? If not, disfavor.
10. Always cite the operator name and guarantee end date in the reasoning.
11. Flag if guarantee period < 5 years (usually a sign of developer
    confidence issue).
12. Flag if price/m² is more than 30% above regional residential
    median — guarantee may be priced into the sticker.
13. For HOTEL_UNIT, never recommend FLIP (illiquid, contract-bound).
    Valid options: RENT (hold) or AVOID.
```

### 12.7 Dashboard UI — `apps/web`

- New property card variant with "Condohotel" badge.
- Different yield panel: guaranteed vs. post-guarantee, side-by-side.
- Operator, guarantee period, and exit restrictions rendered prominently.
- Disclaimer gains a hotel-specific line: *"O rendimento garantido pode
  estar incorporado no preço de venda. Compare preço/m² com residencial
  da mesma zona."*

### 12.8 Sources for this asset class — fetch-policy addendum

Hotel units rarely appear on Idealista / Imovirtual. Primary sources:
- Developer websites (e.g. hoti-hotels.com, pestanainvestments.com,
  viladivestments.com, nauhotels.com).
- Commercial brokerages (Worx, JLL, Cushman & Wakefield).
- **These are bespoke PDFs/prospectos** — the on-demand fetcher should
  allow attaching a PDF or a dedicated "Manual Deal Entry" form in
  Phase 2, rather than trying to scrape every developer microsite.

A new source kind: `MANUAL_PROSPECTUS`, with `fetchMode = ON_DEMAND`
meaning "user uploads / pastes data". This keeps the fetch-policy gate
honest.

---

## 13. One-page summary for the user

| Question | Short answer |
|---|---|
| Can you make money on condohotel? | Yes, but **primarily on appreciation**, not cashflow. |
| Is the guaranteed yield "free money"? | No — **it is usually priced into the sticker**. |
| Is it less work than rental? | **Yes** — genuinely passive. |
| Is it riskier than residential BtL? | **Yes** — operator, liquidity, cyclical, contract lock-in. |
| Does it fit a leveraged investor? | Generally **no** — carry is negative at 70% LTV. |
| Does it fit a cash buyer? | **Maybe** — if appreciation thesis is strong and personal use is valued. |
| Is Golden Visa still available? | **No** — removed October 2023. |
| What to watch in the contract | Guarantee length, default clauses, FF&E reserve, exit lock-up, operator consent on resale. |
| What to watch in the numbers | Price/m² vs. regional residential median; post-guarantee pro forma; refurb reserves. |

---

## 14. Legal/fiscal disclaimer

This document is research and decision support, **not** financial, legal,
or tax advice. All tax figures refer to OE2026 as the base year; rates
and regimes change annually. Before signing any contrato-promessa:

- Engage a **PT advogado** to review the contrato de exploração and
  the empreendimento's registo in Turismo de Portugal.
- Engage a **contabilista certificado** to validate Cat F vs. Cat B
  positioning and the IMT/IS working.
- Ask the developer for the **last 3 years** of the operator's RevPAR
  and occupancy for that specific property (or a comparable). Never
  rely on the prospecto's "projected" numbers alone.
