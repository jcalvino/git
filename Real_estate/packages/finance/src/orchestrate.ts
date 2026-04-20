import {
  type BenchmarkBreakdown,
  type Entry,
  type Financing,
  type FiscalBreakdown,
  type InvestmentSummary,
  type PropertyInput,
  type RegionContext,
  Use,
} from "@real-estate/shared";
import { computeIMT } from "./imt.js";
import { computeImpostoDeSelo } from "./stamp.js";
import { computeCapex } from "./capex.js";
import { computeMortgage } from "./mortgage.js";
import { computeYields } from "./yields.js";
import { scoreRisk } from "./risk.js";
import { round2 } from "./util.js";

export const FIXED_COSTS_EUR = 700;
export const DEFAULT_IMI_RATE = 0.0038;
export const DEFAULT_VPT_RATIO = 0.70;
export const DEFAULT_ANNUAL_CONDO_INSURANCE_EUR = 600;

export interface AnalyzeInput {
  property: PropertyInput;
  financing: Financing;
  use: Use;
  region?: RegionContext;
}

export function analyze(input: AnalyzeInput): InvestmentSummary {
  const { property, financing, use, region } = input;

  const mortgage = computeMortgage(property.priceEUR, financing);

  const imtEUR = computeIMT(property.priceEUR, use);
  const stamp = computeImpostoDeSelo(property.priceEUR, mortgage.principalEUR);
  const fiscal: FiscalBreakdown = {
    imtEUR,
    stamp,
    fixedCostsEUR: FIXED_COSTS_EUR,
    totalFiscalEUR: round2(imtEUR + stamp.totalEUR + FIXED_COSTS_EUR),
  };

  const capex = computeCapex({
    areaM2: property.areaM2,
    declaredLevel: property.condition,
    energyCert: property.energyCert,
    isInARU: property.isInARU,
    propertyType: property.propertyType,
  });

  const realEntryCostEUR = round2(
    mortgage.downpaymentEUR + fiscal.totalFiscalEUR + capex.totalCapexEUR,
  );
  const totalAcquisitionCostEUR = round2(
    property.priceEUR + fiscal.totalFiscalEUR + capex.totalCapexEUR,
  );
  const entry: Entry = { realEntryCostEUR, totalAcquisitionCostEUR };

  const propertyPricePerM2EUR = round2(property.priceEUR / property.areaM2);
  const median = region?.medianPriceM2EUR ?? null;
  const benchmark: BenchmarkBreakdown = {
    propertyPricePerM2EUR,
    regionalMedianPerM2EUR: median,
    deltaPct:
      median && median > 0
        ? round2(((propertyPricePerM2EUR - median) / median) * 100)
        : null,
  };

  const monthlyRent = region?.grossRentMonthlyEstimateEUR ?? 0;
  const imiAnnual =
    property.priceEUR * DEFAULT_VPT_RATIO * (region?.imiRatePct ?? DEFAULT_IMI_RATE * 100) / 100;
  const annualOpex = round2(imiAnnual + DEFAULT_ANNUAL_CONDO_INSURANCE_EUR);
  const annualDebtService = round2(mortgage.monthlyInstallmentEUR * 12);

  const yields = computeYields({
    monthlyRentEUR: monthlyRent,
    totalAcquisitionCostEUR,
    cashInvestedEUR: realEntryCostEUR,
    annualDebtServiceEUR: annualDebtService,
    annualOpexEUR: annualOpex,
  });

  const negativeCarry =
    monthlyRent > 0 && monthlyRent * 0.72 < mortgage.monthlyInstallmentEUR;

  const risk = scoreRisk({
    propertyType: property.propertyType,
    level: capex.level,
    energyCert: property.energyCert,
    deltaPct: benchmark.deltaPct,
    yields,
    negativeCarry,
  });

  return {
    property,
    financing,
    use,
    fiscal,
    capexWorstCase: capex,
    mortgage,
    entry,
    benchmark,
    yields,
    risk,
  };
}
