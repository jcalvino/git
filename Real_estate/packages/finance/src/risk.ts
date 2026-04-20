import {
  CondLevel,
  EnergyCert,
  PropertyType,
  type RiskScores,
  type Yields,
} from "@real-estate/shared";
import { clamp } from "./util.js";

export function scoreRisk(params: {
  propertyType: PropertyType;
  level: CondLevel;
  energyCert: EnergyCert;
  deltaPct: number | null;
  yields: Yields | null;
  negativeCarry: boolean;
}): RiskScores {
  const { propertyType, level, energyCert, deltaPct, yields, negativeCarry } =
    params;

  const notes: string[] = [];
  let flip = 4;
  let rent = 4;

  if (propertyType === PropertyType.HOTEL_UNIT) {
    flip = 10;
    notes.push("Hotel unit — illiquid secondary market, flip effectively blocked");
    rent += 2;
    notes.push("Revenue depends on operator guarantee + share performance");
  }

  if (level === CondLevel.L3_STRUCTURAL) {
    flip += 3;
    notes.push("Structural works — long timeline, licensing risk, budget overrun exposure");
  } else if (level === CondLevel.L2_STANDARD) {
    flip += 1;
  }

  if (energyCert === EnergyCert.F || energyCert === EnergyCert.G) {
    flip += 1;
    rent += 1;
    notes.push("Energy cert F/G — mandatory retrofit before lease, capex forced to L3");
  }
  if (energyCert === EnergyCert.UNKNOWN) {
    flip += 1;
    notes.push("Unknown energy certificate — diligence pending");
  }

  if (deltaPct !== null) {
    if (deltaPct > 15) {
      flip += 2;
      rent += 1;
      notes.push(`Price ${deltaPct.toFixed(1)}% above regional median — thin flip margin`);
    } else if (deltaPct < -15) {
      flip -= 1;
      notes.push(`Price ${deltaPct.toFixed(1)}% below regional median — possible mispricing or hidden defect`);
    }
  }

  if (yields) {
    if (yields.netPct < 3) {
      rent += 2;
      notes.push(`Net yield ${yields.netPct.toFixed(2)}% — below financing cost threshold`);
    } else if (yields.netPct > 6) {
      rent -= 1;
    }
    if (yields.cashOnCashPct < 0) {
      rent += 2;
      notes.push(`Cash-on-cash ${yields.cashOnCashPct.toFixed(2)}% — operation bleeds cash`);
    }
  } else {
    rent += 1;
    notes.push("No regional rent benchmark — rent thesis unvalidated");
  }

  if (negativeCarry) {
    rent += 1;
    flip += 1;
    notes.push("Monthly installment exceeds post-tax rent — negative carry");
  }

  return {
    flipRisk: clamp(Math.round(flip), 1, 10),
    rentRisk: clamp(Math.round(rent), 1, 10),
    notes,
  };
}
