import type { Yields } from "@real-estate/shared";
import { round2 } from "./util.js";

const RENTAL_TAX_RATE = 0.28;
const AFTER_TAX = 1 - RENTAL_TAX_RATE;

export function computeYields(params: {
  monthlyRentEUR: number;
  totalAcquisitionCostEUR: number;
  cashInvestedEUR: number;
  annualDebtServiceEUR: number;
  annualOpexEUR: number;
}): Yields | null {
  const {
    monthlyRentEUR,
    totalAcquisitionCostEUR,
    cashInvestedEUR,
    annualDebtServiceEUR,
    annualOpexEUR,
  } = params;

  if (!Number.isFinite(monthlyRentEUR) || monthlyRentEUR <= 0) return null;
  if (totalAcquisitionCostEUR <= 0 || cashInvestedEUR <= 0) return null;

  const grossAnnualEUR = monthlyRentEUR * 12;
  const netAnnualEUR = grossAnnualEUR * AFTER_TAX - annualOpexEUR;
  const cashFlowAnnualEUR = netAnnualEUR - annualDebtServiceEUR;

  return {
    grossPct: round2((grossAnnualEUR / totalAcquisitionCostEUR) * 100),
    netPct: round2((netAnnualEUR / totalAcquisitionCostEUR) * 100),
    cashOnCashPct: round2((cashFlowAnnualEUR / cashInvestedEUR) * 100),
    grossAnnualEUR: round2(grossAnnualEUR),
    netAnnualEUR: round2(netAnnualEUR),
  };
}
