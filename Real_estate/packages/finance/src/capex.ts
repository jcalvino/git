import {
  CondLevel,
  EnergyCert,
  PropertyType,
  type CapexBreakdown,
} from "@real-estate/shared";
import { round2 } from "./util.js";

const RATE_EUR_PER_M2: Record<CondLevel, number> = {
  [CondLevel.L1_COSMETIC]: 300,
  [CondLevel.L2_STANDARD]: 750,
  [CondLevel.L3_STRUCTURAL]: 1300,
  [CondLevel.UNKNOWN]: 1300,
};

const CONTINGENCY_RATE = 0.20;
const LICENSING_EUR = 3500;
const IVA_RATE_ARU = 0.06;
const IVA_RATE_STANDARD = 0.23;

export function resolveLevel(
  declared: CondLevel,
  energyCert: EnergyCert,
): CondLevel {
  if (energyCert === EnergyCert.F || energyCert === EnergyCert.G) {
    return CondLevel.L3_STRUCTURAL;
  }
  if (declared === CondLevel.UNKNOWN) {
    return CondLevel.L3_STRUCTURAL;
  }
  return declared;
}

export function computeCapex(params: {
  areaM2: number;
  declaredLevel: CondLevel;
  energyCert: EnergyCert;
  isInARU: boolean;
  propertyType: PropertyType;
}): CapexBreakdown {
  const { areaM2, declaredLevel, energyCert, isInARU, propertyType } = params;
  if (!Number.isFinite(areaM2) || areaM2 <= 0) {
    throw new Error(`Invalid areaM2: ${areaM2}`);
  }

  const level = resolveLevel(declaredLevel, energyCert);
  const ratePerM2EUR = RATE_EUR_PER_M2[level];
  const baseWorksEUR = round2(areaM2 * ratePerM2EUR);
  const contingencyEUR = round2(baseWorksEUR * CONTINGENCY_RATE);
  const licensingEUR = LICENSING_EUR;

  const isHotel =
    propertyType === PropertyType.HOTEL_UNIT ||
    propertyType === PropertyType.TOURIST_APARTMENT;
  const ivaRate = isHotel
    ? IVA_RATE_STANDARD
    : isInARU
      ? IVA_RATE_ARU
      : IVA_RATE_STANDARD;

  const subtotal = baseWorksEUR + contingencyEUR + licensingEUR;
  const ivaEUR = round2(subtotal * ivaRate);
  const totalCapexEUR = round2(subtotal + ivaEUR);

  return {
    level,
    ratePerM2EUR,
    baseWorksEUR,
    contingencyEUR,
    licensingEUR,
    ivaRate,
    ivaEUR,
    totalCapexEUR,
  };
}
