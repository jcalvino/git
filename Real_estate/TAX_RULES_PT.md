# Portuguese Tax & Cost Rules — Portugal Continental

Single source of truth for all fiscal calculations. Values ingested from the
official tables provided by the user (OE2026 brackets). Any scraper,
financial engine, or LLM prompt **must** read from this document (or the
seeded `tax_brackets` table derived from it) — never hard-code elsewhere.

Scope: **Portugal Continental only**. Madeira / Açores excluded from MVP.

---

## 1. IMT — Imposto Municipal sobre Transmissões Onerosas

Formula (progressive brackets, except two top "Taxa Única" slabs):

```
IMT = (Price × MarginalRate) − ParcelaAbater
```

For the two top brackets (`> €660,982`), the rate is flat and `ParcelaAbater = 0`:

```
IMT = Price × FlatRate
```

### 1.1 HPP — Habitação Própria e Permanente (primary residence)

| Escalão (Valor do Imóvel) | Taxa Marginal | Parcela a Abater |
|---|---|---|
| Até €106,346 | **0% (Isento)** | €0 |
| €106,346 — €145,470 | 2% | €2,126.92 |
| €145,470 — €198,347 | 5% | €6,491.02 |
| €198,347 — €330,539 | 7% | €10,457.96 |
| €330,539 — €660,982 | 8% | €13,763.35 |
| €660,982 — €1,150,853 | 6% (Taxa Única) | €0 |
| > €1,150,853 | 7.5% (Taxa Única) | €0 |

### 1.2 Investment / Secondary residence (Buy-to-Let, Flip, Holiday home)

| Escalão (Valor do Imóvel) | Taxa Marginal | Parcela a Abater |
|---|---|---|
| Até €106,346 | **1%** | €0 |
| €106,346 — €145,470 | 2% | €1,063.46 |
| €145,470 — €198,347 | 5% | €5,427.56 |
| €198,347 — €330,539 | 7% | €9,394.50 |
| €330,539 — €660,982 | 8% | €12,699.89 |
| €660,982 — €1,150,853 | 6% (Taxa Única) | €0 |
| > €1,150,853 | 7.5% (Taxa Única) | €0 |

### 1.3 Worked examples

- **HPP, Price = €95,000** → 0% → **IMT = €0**
- **HPP, Price = €250,000** → bracket 4 → `250,000 × 0.07 − 10,457.96` = **€7,042.04**
- **Investment, Price = €95,000** → `95,000 × 0.01` = **€950.00**
- **Investment, Price = €250,000** → `250,000 × 0.07 − 9,394.50` = **€8,105.50**
- **Investment, Price = €800,000** → flat 6% → **€48,000.00**

---

## 2. IS — Imposto de Selo (Stamp Duty)

Two distinct applications, both mandatory when a mortgage is used:

| Component | Base | Rate |
|---|---|---|
| IS on acquisition | Purchase price | **0.8%** |
| IS on mortgage (Verba 17) | Mortgage principal | **0.6%** (loans ≥ 5y) |

Notes:
- IS on acquisition applies even without a mortgage.
- Verba 17.1.3: loans < 5y use 0.5%, ≥ 5y use 0.6%. MVP assumes ≥ 5y.

---

## 3. Fixed Closing Costs

| Item | Value (MVP assumption) |
|---|---|
| Mortgage setup + Notary + Registo Predial (bundled) | **€700** |

> This is the user-specified simplification. Real-world range is €1,000–€2,500
> depending on bank and notary. The €700 figure is deliberately aggressive —
> the 1.20× CAPEX contingency plus €3,500 licensing buffer absorbs variance.

---

## 4. IVA on Renovation Works (ARU rule)

| Location | IVA rate applied to CAPEX |
|---|---|
| Inside ARU (Área de Reabilitação Urbana) | **6%** |
| Outside ARU | **23%** |

The ARU boundary is per-municipality. Seed table: `aru_zones(freguesia, polygon)`.
If the property's freguesia is unknown, default to 23% (worst case for CAPEX).

---

## 5. Rental Income Taxation

For Net Yield calculation the platform uses the **flat 28% taxa liberatória**
(Categoria F, non-optional regime).

```
NetRent_Annual = GrossRent_Annual × (1 − 0.28) = GrossRent_Annual × 0.72
```

Lower rates (5%–14%) exist for long-duration contracts under the 2023
Mais Habitação regime; these are **not** applied in MVP to stay conservative.

---

## 6. IMI — Imposto Municipal sobre Imóveis (annual holding cost)

Levied on VPT (Valor Patrimonial Tributário), not on market price.

| Item | Default assumption |
|---|---|
| VPT / Market price ratio | **0.70** |
| IMI rate (urban, continental median) | **0.38%** of VPT |
| Effective IMI | ≈ `Price × 0.70 × 0.00380` = `Price × 0.00266` |

Municipality-specific overrides (0.30%–0.45%) live in `regions.imi_rate`.

---

## 7. Other Recurring Costs (for Net Yield)

| Item | Default |
|---|---|
| Condomínio (condo fees) | €50/month baseline, scale with area |
| Seguro multirriscos | €150/year |
| Vacancy provision | 1 month/year (8.33%) |
| Management fee (optional) | 8% of rent |

Disabled by default to match the user's Net Yield formula exactly (only the
28% income tax and IMI are deducted). Expose as toggles in the UI.

---

## 8. Refresh cadence

| Table | Owner | Refresh | Source |
|---|---|---|---|
| `tax_brackets` (IMT) | Tax_Engine | Annual (Jan, OE publication) | OE / Portaria |
| `imi_rates` | Tax_Engine | Annual | Portal das Finanças |
| `aru_zones` | Manual | Annual | Each Câmara Municipal |
| `mortgage_rates` (Euribor + spreads) | Financing_Logic | Weekly | ECB + top-5 PT banks |

All refreshes are Prisma migrations or seed scripts — never hand-edited.
