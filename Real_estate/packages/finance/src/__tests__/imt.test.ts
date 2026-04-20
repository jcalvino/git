import { describe, it, expect } from "vitest";
import { Use } from "@real-estate/shared";
import { computeIMT } from "../imt.js";

describe("computeIMT — HPP (OE2026)", () => {
  it("is €0 at and below €106,346", () => {
    expect(computeIMT(0, Use.HPP)).toBe(0);
    expect(computeIMT(50000, Use.HPP)).toBe(0);
    expect(computeIMT(95000, Use.HPP)).toBe(0);
    expect(computeIMT(106346, Use.HPP)).toBe(0);
  });

  it("€250k → €7,042.04", () => {
    expect(computeIMT(250000, Use.HPP)).toBe(7042.04);
  });

  it("€330,539 → €12,679.77", () => {
    expect(computeIMT(330539, Use.HPP)).toBe(12679.77);
  });

  it("€700k flat bracket → €42,000", () => {
    expect(computeIMT(700000, Use.HPP)).toBe(42000);
  });

  it("€1.5M top bracket → €112,500", () => {
    expect(computeIMT(1500000, Use.HPP)).toBe(112500);
  });
});

describe("computeIMT — INVESTMENT (OE2026)", () => {
  it("€95k → €950 (1% base)", () => {
    expect(computeIMT(95000, Use.INVESTMENT)).toBe(950);
  });

  it("€250k → €8,105.50", () => {
    expect(computeIMT(250000, Use.INVESTMENT)).toBe(8105.5);
  });

  it("€800k flat bracket → €48,000", () => {
    expect(computeIMT(800000, Use.INVESTMENT)).toBe(48000);
  });

  it("€1.5M top bracket → €112,500", () => {
    expect(computeIMT(1500000, Use.INVESTMENT)).toBe(112500);
  });
});

describe("computeIMT — error handling", () => {
  it("rejects negative prices", () => {
    expect(() => computeIMT(-1, Use.HPP)).toThrow();
  });

  it("rejects NaN", () => {
    expect(() => computeIMT(Number.NaN, Use.HPP)).toThrow();
  });
});
