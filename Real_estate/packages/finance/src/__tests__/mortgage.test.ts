import { describe, it, expect } from "vitest";
import { computeMortgage, monthlyInstallment } from "../mortgage.js";

describe("monthlyInstallment", () => {
  it("0% rate → principal divided by months", () => {
    expect(monthlyInstallment(100000, 0, 30)).toBeCloseTo(100000 / 360, 5);
  });

  it("€100k @ 6% over 30y ≈ €599.55", () => {
    expect(monthlyInstallment(100000, 6, 30)).toBeCloseTo(599.55, 1);
  });

  it("€196k @ 5.2% over 20y lands between €1,300 and €1,330", () => {
    const m = monthlyInstallment(196000, 5.2, 20);
    expect(m).toBeGreaterThan(1300);
    expect(m).toBeLessThan(1330);
  });

  it("zero principal → 0", () => {
    expect(monthlyInstallment(0, 5, 30)).toBe(0);
  });
});

describe("computeMortgage", () => {
  it("LTV 0.8 on €250k → €200k principal, €50k downpayment", () => {
    const m = computeMortgage(250000, {
      ltv: 0.8,
      annualRatePct: 5,
      years: 30,
    });
    expect(m.principalEUR).toBe(200000);
    expect(m.downpaymentEUR).toBe(50000);
    expect(m.holdingCost6mEUR).toBeCloseTo(m.monthlyInstallmentEUR * 6, 1);
  });

  it("total interest is positive for non-zero rate", () => {
    const m = computeMortgage(300000, {
      ltv: 0.8,
      annualRatePct: 4.5,
      years: 25,
    });
    expect(m.totalInterestEUR).toBeGreaterThan(0);
  });
});
