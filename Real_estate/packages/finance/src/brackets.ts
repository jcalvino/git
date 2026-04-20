import { Use } from "@real-estate/shared";

export interface Bracket {
  upperLimit: number | null;
  rate: number;
  deduction: number;
}

export const BRACKETS_HPP_OE2026: readonly Bracket[] = [
  { upperLimit: 106346, rate: 0, deduction: 0 },
  { upperLimit: 145824, rate: 0.02, deduction: 2126.92 },
  { upperLimit: 198890, rate: 0.05, deduction: 6491.02 },
  { upperLimit: 331483, rate: 0.07, deduction: 10457.96 },
  { upperLimit: 662962, rate: 0.08, deduction: 13763.35 },
  { upperLimit: 1000000, rate: 0.06, deduction: 0 },
  { upperLimit: null, rate: 0.075, deduction: 0 },
] as const;

export const BRACKETS_INVESTMENT_OE2026: readonly Bracket[] = [
  { upperLimit: 106346, rate: 0.01, deduction: 0 },
  { upperLimit: 145824, rate: 0.02, deduction: 1063.46 },
  { upperLimit: 198890, rate: 0.05, deduction: 5427.56 },
  { upperLimit: 331483, rate: 0.07, deduction: 9394.50 },
  { upperLimit: 662962, rate: 0.08, deduction: 12699.89 },
  { upperLimit: 1000000, rate: 0.06, deduction: 0 },
  { upperLimit: null, rate: 0.075, deduction: 0 },
] as const;

export function getBrackets(use: Use): readonly Bracket[] {
  return use === Use.HPP ? BRACKETS_HPP_OE2026 : BRACKETS_INVESTMENT_OE2026;
}
