# Finance Engine — Deterministic Spec

`packages/finance/` — pure TypeScript. **No LLM calls**. Every function is
a pure function of its inputs. Full unit-test coverage against worked examples.

All tax parameters are read from the `tax_brackets` / `imi_rates` tables
seeded from [TAX_RULES_PT.md](TAX_RULES_PT.md). Never hard-code rates here.

---

## 1. Types

```ts
export type Use = "HPP" | "INVESTMENT";
export type CondLevel = "L1_COSMETIC" | "L2_STANDARD" | "L3_STRUCTURAL";
export type EnergyCert = "A+" | "A" | "B" | "B-" | "C" | "D" | "E" | "F" | "G" | null;

export interface Property {
  priceEUR: number;           // asking price
  areaM2: number;             // gross private area (ABP)
  typology: string;           // T0, T1, T2, ...
  freguesia: string;          // parish — drives ARU + IMI lookup
  energyCert: EnergyCert;
  condition?: CondLevel;      // defaults by heuristic (see §4)
  isInARU?: boolean;          // resolved via aru_zones table
}

export interface Financing {
  ltv: number;                // 0.80 – 0.90
  annualRatePct: number;      // Euribor 12m + spread
  years: number;              // 25, 30, 35, 40
}

export interface FiscalBreakdown {
  imt: number;
  isAcquisition: number;      // 0.8% × price
  isMortgage: number;         // 0.6% × principal
  fixedCosts: number;         // €700
  totalFiscal: number;
}

export interface CapexBreakdown {
  level: CondLevel;
  ratePerM2: number;          // 300 / 750 / 1300
  baseWorks: number;          // area × rate
  contingency: number;        // baseWorks × 0.20
  licensing: number;          // 3500
  ivaRate: number;            // 0.06 (ARU) or 0.23
  iva: number;
  totalCapex: number;         // worst-case
}

export interface MortgageBreakdown {
  principal: number;          // price × ltv
  downpayment: number;        // price × (1 − ltv)
  monthlyInstallment: number;
  totalInterest: number;
  holdingCost6m: number;      // 6 × monthlyInstallment during reno
}

export interface PerformanceMetrics {
  realEntryCost: number;      // downpayment + fiscal + capex + holding
  totalAcquisitionCost: number; // price + fiscal + capex
  grossYieldPct: number;
  netYieldPct: number;
  cashOnCashPct: number;
  priceVsRegionPct: number;   // (propPriceM2 − regionMedianM2) / regionMedianM2
}
```

---

## 2. IMT — `computeIMT(price, use)`

```ts
function computeIMT(price: number, use: Use): number {
  const brackets = loadBrackets(use);      // from tax_brackets table
  const b = brackets.find(b => price <= b.ceilingEUR) ?? brackets.at(-1)!;
  if (b.isFlat) return price * b.ratePct;
  return Math.max(0, price * b.ratePct - b.deductionEUR);
}
```

Golden tests (see [TAX_RULES_PT.md §1.3](TAX_RULES_PT.md)):

| Use | Price | Expected IMT |
|---|---|---|
| HPP | €95,000 | €0 |
| HPP | €250,000 | €7,042.04 |
| INVESTMENT | €95,000 | €950.00 |
| INVESTMENT | €250,000 | €8,105.50 |
| INVESTMENT | €800,000 | €48,000.00 |

---

## 3. IS — `computeImpostoDeSelo(price, principal)`

```ts
function computeImpostoDeSelo(price: number, principal: number): {
  acquisition: number; mortgage: number;
} {
  return {
    acquisition: price * 0.008,
    mortgage:    principal > 0 ? principal * 0.006 : 0,
  };
}
```

---

## 4. CAPEX — `computeCapex(property)`

### 4.1 Level inference (when `condition` is not provided)

```
if energyCert ∈ {F, G}                → L3_STRUCTURAL   (forced)
else if description matches /para recuperar|para obras|devoluto/i  → L3
else if description matches /remodelado há|a remodelar|obras parciais/i → L2
else                                   → L1 (default, but see stress test)
```

The user's worst-case rule says: **always apply the stress test formula**,
which bakes in a 20% contingency plus €3,500 licensing regardless of level.

### 4.2 Rates (€/m²)

| Level | Rate |
|---|---|
| L1_COSMETIC | 300 |
| L2_STANDARD | 750 |
| L3_STRUCTURAL | 1,300 |

### 4.3 Formula

```ts
function computeCapex(p: Property): CapexBreakdown {
  const level = p.condition ?? inferLevel(p);
  const rate  = CAPEX_RATES[level];
  const baseWorks   = p.areaM2 * rate;
  const contingency = baseWorks * 0.20;
  const licensing   = 3500;
  const ivaRate     = p.isInARU ? 0.06 : 0.23;
  const preIva      = baseWorks + contingency + licensing;
  const iva         = preIva * ivaRate;
  return {
    level, ratePerM2: rate, baseWorks, contingency, licensing,
    ivaRate, iva, totalCapex: preIva + iva,
  };
}
```

Example — 80 m² apartment, cert F, outside ARU:
- Forced L3: 80 × 1,300 = €104,000
- +20% = €124,800
- +€3,500 = €128,300
- ×1.23 IVA = **€157,809** worst-case CAPEX.

---

## 5. Mortgage — `computeMortgage(price, financing)`

French amortization (fixed installment):

```ts
function monthlyInstallment(principal: number, annualRatePct: number, years: number): number {
  const i = annualRatePct / 100 / 12;
  const n = years * 12;
  if (i === 0) return principal / n;
  return (principal * i) / (1 - Math.pow(1 + i, -n));
}
```

```ts
function computeMortgage(price: number, f: Financing): MortgageBreakdown {
  const principal   = price * f.ltv;
  const downpayment = price - principal;
  const m = monthlyInstallment(principal, f.annualRatePct, f.years);
  return {
    principal, downpayment,
    monthlyInstallment: m,
    totalInterest: m * f.years * 12 - principal,
    holdingCost6m: m * 6,
  };
}
```

---

## 6. Fiscal + Total Entry — `computeEntry(property, financing, use)`

```ts
function computeFiscal(price: number, principal: number, use: Use): FiscalBreakdown {
  const imt = computeIMT(price, use);
  const { acquisition, mortgage } = computeImpostoDeSelo(price, principal);
  const fixedCosts = 700;
  return {
    imt, isAcquisition: acquisition, isMortgage: mortgage, fixedCosts,
    totalFiscal: imt + acquisition + mortgage + fixedCosts,
  };
}

function computeEntry(p: Property, f: Financing, use: Use) {
  const m     = computeMortgage(p.priceEUR, f);
  const fisc  = computeFiscal(p.priceEUR, m.principal, use);
  const capex = computeCapex(p);
  const realEntryCost =
    m.downpayment + fisc.totalFiscal + capex.totalCapex + m.holdingCost6m;
  const totalAcquisitionCost = p.priceEUR + fisc.totalFiscal + capex.totalCapex;
  return { mortgage: m, fiscal: fisc, capex, realEntryCost, totalAcquisitionCost };
}
```

---

## 7. Yields — `computeYields(entry, rent, imi)`

```ts
function computeYields(
  entry: ReturnType<typeof computeEntry>,
  grossRentMonthly: number,
  imiAnnual: number,
): { gross: number; net: number; cashOnCash: number } {
  const grossAnnual = grossRentMonthly * 12;
  const netAnnual   = grossAnnual * 0.72 - imiAnnual;   // 28% flat + IMI
  return {
    gross:       grossAnnual / entry.totalAcquisitionCost,
    net:         netAnnual   / entry.totalAcquisitionCost,
    cashOnCash:  (netAnnual - 12 * entry.mortgage.monthlyInstallment) / entry.realEntryCost,
  };
}
```

IMI defaults to `price × 0.00266` unless the freguesia override is present.

---

## 8. Flip vs. Rent — Risk Score (1–10)

Deterministic scorer; LLM Advisor later adds narrative.

```ts
interface RiskInputs {
  netYieldPct: number;            // rental path
  priceVsRegionPct: number;       // −0.10 = 10% below median
  daysOnMarket?: number;          // if we have the history
  energyCert: EnergyCert;
  capexShareOfPrice: number;      // capex / price
  liquidityScore: number;         // 0–1, derived from region turnover
}
```

**Buy-to-Let risk (1 = safest, 10 = riskiest)**: dominated by net yield vs.
financing cost. Penalize when `netYield < mortgageRate + 1.5%` (negative
carry). Penalize high CAPEX share.

**Flip risk**: dominated by `priceVsRegionPct`, liquidity, and renovation
scope. Penalize when property is already at/above median, when `capexShare > 25%`,
and when the region has low turnover.

Scorer uses a weighted linear combination clamped to [1, 10]; weights live in
`packages/finance/src/risk.ts` and are unit-tested against reference cases.

---

## 9. Output contract (JSON for UI / Advisor)

```ts
interface InvestmentSummary {
  property: { sourceUrl; priceEUR; areaM2; typology; freguesia; energyCert; };
  fiscal: FiscalBreakdown;
  capexWorstCase: CapexBreakdown;
  mortgage: MortgageBreakdown;
  entry: { realEntryCost; totalAcquisitionCost };
  benchmark: { regionalMedianM2; propertyPriceM2; deltaPct };
  yields: { gross; net; cashOnCash };
  verdict: {
    flipRisk: number;      // 1–10
    rentRisk: number;      // 1–10
    recommended: "FLIP" | "RENT" | "AVOID";
    confidence: number;    // 0–1
    redFlags: string[];
    reasoning: string;     // LLM-generated narrative
  };
}
```

This is the exact shape the Advisor agent returns and the React dashboard
consumes — contract is frozen in `packages/shared/src/contracts.ts`.
