import { Use } from "@real-estate/shared";
import { getBrackets } from "./brackets.js";
import { round2 } from "./util.js";

export function computeIMT(priceEUR: number, use: Use): number {
  if (!Number.isFinite(priceEUR) || priceEUR < 0) {
    throw new Error(`Invalid priceEUR: ${priceEUR}`);
  }
  const brackets = getBrackets(use);
  for (const b of brackets) {
    if (b.upperLimit === null || priceEUR <= b.upperLimit) {
      const raw = priceEUR * b.rate - b.deduction;
      return round2(Math.max(0, raw));
    }
  }
  throw new Error("IMT bracket resolution failed");
}
