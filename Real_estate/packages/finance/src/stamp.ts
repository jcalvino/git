import type { StampBreakdown } from "@real-estate/shared";
import { round2 } from "./util.js";

const IS_ACQUISITION_RATE = 0.008;
const IS_MORTGAGE_RATE = 0.006;

export function computeImpostoDeSelo(
  priceEUR: number,
  mortgagePrincipalEUR: number,
): StampBreakdown {
  const acquisitionEUR = round2(priceEUR * IS_ACQUISITION_RATE);
  const mortgageEUR = round2(mortgagePrincipalEUR * IS_MORTGAGE_RATE);
  return {
    acquisitionEUR,
    mortgageEUR,
    totalEUR: round2(acquisitionEUR + mortgageEUR),
  };
}
