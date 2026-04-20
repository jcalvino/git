import { describe, it, expect } from "vitest";
import { computeYields } from "../yields.js";

describe("computeYields", () => {
  it("applies 28% flat rental tax in net yield", () => {
    const y = computeYields({
      monthlyRentEUR: 1000,
      totalAcquisitionCostEUR: 200000,
      cashInvestedEUR: 60000,
      annualDebtServiceEUR: 7200,
      annualOpexEUR: 1200,
    });
    expect(y).not.toBeNull();
    expect(y!.grossAnnualEUR).toBe(12000);
    // net = 12000 × 0.72 − 1200 = 8640 − 1200 = 7440
    expect(y!.netAnnualEUR).toBe(7440);
    expect(y!.grossPct).toBe(6);
    expect(y!.netPct).toBe(3.72);
    // cash-on-cash = (7440 − 7200) / 60000 = 0.4%
    expect(y!.cashOnCashPct).toBeCloseTo(0.4, 2);
  });

  it("returns null when no rent is provided", () => {
    expect(
      computeYields({
        monthlyRentEUR: 0,
        totalAcquisitionCostEUR: 200000,
        cashInvestedEUR: 60000,
        annualDebtServiceEUR: 7200,
        annualOpexEUR: 1200,
      }),
    ).toBeNull();
  });

  it("cash-on-cash goes negative when debt service exceeds net income", () => {
    const y = computeYields({
      monthlyRentEUR: 800,
      totalAcquisitionCostEUR: 300000,
      cashInvestedEUR: 80000,
      annualDebtServiceEUR: 14000,
      annualOpexEUR: 1500,
    });
    expect(y!.cashOnCashPct).toBeLessThan(0);
  });
});
