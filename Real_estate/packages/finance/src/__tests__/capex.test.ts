import { describe, it, expect } from "vitest";
import {
  CondLevel,
  EnergyCert,
  PropertyType,
} from "@real-estate/shared";
import { computeCapex, resolveLevel } from "../capex.js";

describe("resolveLevel", () => {
  it("forces L3 on cert F", () => {
    expect(resolveLevel(CondLevel.L1_COSMETIC, EnergyCert.F)).toBe(
      CondLevel.L3_STRUCTURAL,
    );
  });

  it("forces L3 on cert G", () => {
    expect(resolveLevel(CondLevel.L2_STANDARD, EnergyCert.G)).toBe(
      CondLevel.L3_STRUCTURAL,
    );
  });

  it("forces L3 when declared UNKNOWN", () => {
    expect(resolveLevel(CondLevel.UNKNOWN, EnergyCert.B)).toBe(
      CondLevel.L3_STRUCTURAL,
    );
  });

  it("respects declared level when cert is not F/G", () => {
    expect(resolveLevel(CondLevel.L1_COSMETIC, EnergyCert.A)).toBe(
      CondLevel.L1_COSMETIC,
    );
  });
});

describe("computeCapex — worst-case formula", () => {
  it("80 m² cert F outside ARU → €157,809", () => {
    const c = computeCapex({
      areaM2: 80,
      declaredLevel: CondLevel.L2_STANDARD,
      energyCert: EnergyCert.F,
      isInARU: false,
      propertyType: PropertyType.RESIDENTIAL_APARTMENT,
    });
    expect(c.level).toBe(CondLevel.L3_STRUCTURAL);
    expect(c.ratePerM2EUR).toBe(1300);
    expect(c.baseWorksEUR).toBe(104000);
    expect(c.contingencyEUR).toBe(20800);
    expect(c.licensingEUR).toBe(3500);
    expect(c.ivaRate).toBe(0.23);
    expect(c.totalCapexEUR).toBe(157809);
  });

  it("80 m² cert F inside ARU → €135,998", () => {
    const c = computeCapex({
      areaM2: 80,
      declaredLevel: CondLevel.L2_STANDARD,
      energyCert: EnergyCert.F,
      isInARU: true,
      propertyType: PropertyType.RESIDENTIAL_APARTMENT,
    });
    expect(c.ivaRate).toBe(0.06);
    expect(c.totalCapexEUR).toBe(135998);
  });

  it("L1 cosmetic 80 m² outside ARU → €39,729", () => {
    const c = computeCapex({
      areaM2: 80,
      declaredLevel: CondLevel.L1_COSMETIC,
      energyCert: EnergyCert.B,
      isInARU: false,
      propertyType: PropertyType.RESIDENTIAL_APARTMENT,
    });
    expect(c.baseWorksEUR).toBe(24000);
    expect(c.contingencyEUR).toBe(4800);
    expect(c.totalCapexEUR).toBe(39729);
  });

  it("hotel unit always 23% IVA even inside ARU", () => {
    const c = computeCapex({
      areaM2: 40,
      declaredLevel: CondLevel.L1_COSMETIC,
      energyCert: EnergyCert.A,
      isInARU: true,
      propertyType: PropertyType.HOTEL_UNIT,
    });
    expect(c.ivaRate).toBe(0.23);
  });
});
