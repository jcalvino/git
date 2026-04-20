import { RevenueModel } from "@real-estate/shared";
import { round2 } from "./util.js";

export interface HotelRevenueInput {
  purchasePriceEUR: number;
  revenueModel: RevenueModel;
  guaranteedAnnualRatePct?: number;
  guaranteeYears?: number;
  sharePctToOwner?: number;
  expectedAnnualGrossRevenueEUR?: number;
}

export interface HotelRevenueStream {
  guaranteeMonthlyEUR: number;
  guaranteeYears: number;
  shareMonthlyEUR: number;
  sharePctToOwner: number;
  blendedFirstYearMonthlyEUR: number;
}

export function hotelRevenueStream(input: HotelRevenueInput): HotelRevenueStream {
  const {
    purchasePriceEUR,
    revenueModel,
    guaranteedAnnualRatePct = 0,
    guaranteeYears = 0,
    sharePctToOwner = 0,
    expectedAnnualGrossRevenueEUR = 0,
  } = input;

  const guaranteeAnnual =
    revenueModel === RevenueModel.GUARANTEED_THEN_SHARE ||
    revenueModel === RevenueModel.MIXED
      ? purchasePriceEUR * (guaranteedAnnualRatePct / 100)
      : 0;
  const guaranteeMonthlyEUR = round2(guaranteeAnnual / 12);

  const shareAnnual = expectedAnnualGrossRevenueEUR * (sharePctToOwner / 100);
  const shareMonthlyEUR = round2(shareAnnual / 12);

  const firstYearMonthly =
    guaranteeYears > 0 ? guaranteeMonthlyEUR : shareMonthlyEUR;

  return {
    guaranteeMonthlyEUR,
    guaranteeYears,
    shareMonthlyEUR,
    sharePctToOwner,
    blendedFirstYearMonthlyEUR: round2(firstYearMonthly),
  };
}
