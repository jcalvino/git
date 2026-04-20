import type { Financing, MortgageBreakdown } from "@real-estate/shared";
import { round2 } from "./util.js";

export function monthlyInstallment(
  principalEUR: number,
  annualRatePct: number,
  years: number,
): number {
  if (principalEUR <= 0 || years <= 0) return 0;
  const n = years * 12;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principalEUR / n;
  return (principalEUR * r) / (1 - Math.pow(1 + r, -n));
}

export function computeMortgage(
  priceEUR: number,
  financing: Financing,
): MortgageBreakdown {
  const principalEUR = round2(priceEUR * financing.ltv);
  const downpaymentEUR = round2(priceEUR - principalEUR);
  const monthly = monthlyInstallment(
    principalEUR,
    financing.annualRatePct,
    financing.years,
  );
  const monthlyInstallmentEUR = round2(monthly);
  const totalInterestEUR = round2(monthly * financing.years * 12 - principalEUR);
  const holdingCost6mEUR = round2(monthly * 6);

  return {
    principalEUR,
    downpaymentEUR,
    monthlyInstallmentEUR,
    totalInterestEUR,
    holdingCost6mEUR,
  };
}
