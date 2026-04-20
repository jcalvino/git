import { describe, it, expect } from "vitest";
import { computeImpostoDeSelo } from "../stamp.js";

describe("computeImpostoDeSelo", () => {
  it("0.8% on acquisition, 0.6% on mortgage", () => {
    const s = computeImpostoDeSelo(250000, 200000);
    expect(s.acquisitionEUR).toBe(2000);
    expect(s.mortgageEUR).toBe(1200);
    expect(s.totalEUR).toBe(3200);
  });

  it("zero mortgage → only acquisition component", () => {
    const s = computeImpostoDeSelo(150000, 0);
    expect(s.acquisitionEUR).toBe(1200);
    expect(s.mortgageEUR).toBe(0);
    expect(s.totalEUR).toBe(1200);
  });
});
