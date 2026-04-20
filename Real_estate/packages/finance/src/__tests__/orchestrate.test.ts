import { describe, it, expect } from "vitest";
import {
  CondLevel,
  EnergyCert,
  PropertyType,
  Source,
  Use,
  type PropertyInput,
  type Financing,
} from "@real-estate/shared";
import { analyze } from "../orchestrate.js";

const baseProperty: PropertyInput = {
  sourceUrl: "https://idealista.pt/imovel/1",
  source: Source.IDEALISTA,
  priceEUR: 250000,
  areaM2: 80,
  typology: "T2",
  freguesia: "Arroios",
  energyCert: EnergyCert.C,
  condition: CondLevel.L2_STANDARD,
  isInARU: false,
  propertyType: PropertyType.RESIDENTIAL_APARTMENT,
};

const baseFinancing: Financing = {
  ltv: 0.8,
  annualRatePct: 4.5,
  years: 30,
};

describe("analyze", () => {
  it("assembles a full investment summary", () => {
    const s = analyze({
      property: baseProperty,
      financing: baseFinancing,
      use: Use.HPP,
    });
    expect(s.fiscal.imtEUR).toBe(7042.04);
    expect(s.fiscal.fixedCostsEUR).toBe(700);
    expect(s.mortgage.principalEUR).toBe(200000);
    expect(s.mortgage.downpaymentEUR).toBe(50000);
    expect(s.capexWorstCase.level).toBe(CondLevel.L2_STANDARD);
    expect(s.entry.totalAcquisitionCostEUR).toBeGreaterThan(
      baseProperty.priceEUR,
    );
    expect(s.yields).toBeNull();
    expect(s.benchmark.propertyPricePerM2EUR).toBe(3125);
    expect(s.risk.flipRisk).toBeGreaterThanOrEqual(1);
    expect(s.risk.flipRisk).toBeLessThanOrEqual(10);
  });

  it("forces L3 capex when energy cert is F", () => {
    const s = analyze({
      property: { ...baseProperty, energyCert: EnergyCert.F },
      financing: baseFinancing,
      use: Use.INVESTMENT,
    });
    expect(s.capexWorstCase.level).toBe(CondLevel.L3_STRUCTURAL);
    expect(s.capexWorstCase.totalCapexEUR).toBe(157809);
  });

  it("computes yields and benchmark when region context is provided", () => {
    const s = analyze({
      property: baseProperty,
      financing: baseFinancing,
      use: Use.INVESTMENT,
      region: {
        medianPriceM2EUR: 3000,
        grossRentMonthlyEstimateEUR: 1100,
        imiRatePct: 0.38,
      },
    });
    expect(s.yields).not.toBeNull();
    expect(s.yields!.grossAnnualEUR).toBe(13200);
    expect(s.benchmark.regionalMedianPerM2EUR).toBe(3000);
    expect(s.benchmark.deltaPct).toBeCloseTo(4.17, 1);
  });

  it("flags hotel units as flip-illiquid (risk = 10)", () => {
    const s = analyze({
      property: {
        ...baseProperty,
        propertyType: PropertyType.HOTEL_UNIT,
        priceEUR: 280000,
      },
      financing: { ltv: 0.6, annualRatePct: 5.5, years: 20 },
      use: Use.INVESTMENT,
    });
    expect(s.risk.flipRisk).toBe(10);
  });
});
