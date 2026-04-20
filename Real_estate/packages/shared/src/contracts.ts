import type {
  CondLevel,
  EnergyCert,
  PropertyType,
  Recommendation,
  Source,
  Use,
} from "./enums.js";

export interface PropertyInput {
  sourceUrl: string;
  source: Source;
  priceEUR: number;
  areaM2: number;
  typology: string;
  freguesia: string;
  energyCert: EnergyCert;
  condition: CondLevel;
  isInARU: boolean;
  propertyType: PropertyType;
  yearBuilt?: number;
  bedrooms?: number;
  bathrooms?: number;
}

export interface Financing {
  ltv: number;
  annualRatePct: number;
  years: number;
}

export interface RegionContext {
  medianPriceM2EUR?: number;
  medianRentM2EUR?: number;
  imiRatePct?: number;
  grossRentMonthlyEstimateEUR?: number;
  liquidityScore?: number;
}

export interface StampBreakdown {
  acquisitionEUR: number;
  mortgageEUR: number;
  totalEUR: number;
}

export interface FiscalBreakdown {
  imtEUR: number;
  stamp: StampBreakdown;
  fixedCostsEUR: number;
  totalFiscalEUR: number;
}

export interface CapexBreakdown {
  level: CondLevel;
  ratePerM2EUR: number;
  baseWorksEUR: number;
  contingencyEUR: number;
  licensingEUR: number;
  ivaRate: number;
  ivaEUR: number;
  totalCapexEUR: number;
}

export interface MortgageBreakdown {
  principalEUR: number;
  downpaymentEUR: number;
  monthlyInstallmentEUR: number;
  totalInterestEUR: number;
  holdingCost6mEUR: number;
}

export interface Yields {
  grossPct: number;
  netPct: number;
  cashOnCashPct: number;
  grossAnnualEUR: number;
  netAnnualEUR: number;
}

export interface RiskScores {
  flipRisk: number;
  rentRisk: number;
  notes: string[];
}

export interface BenchmarkBreakdown {
  propertyPricePerM2EUR: number;
  regionalMedianPerM2EUR: number | null;
  deltaPct: number | null;
}

export interface Entry {
  realEntryCostEUR: number;
  totalAcquisitionCostEUR: number;
}

export interface AdvisorVerdict {
  recommended: Recommendation;
  confidence: number;
  redFlags: string[];
  reasoning: string[];
  degraded: boolean;
}

export interface InvestmentSummary {
  property: PropertyInput;
  financing: Financing;
  use: Use;
  fiscal: FiscalBreakdown;
  capexWorstCase: CapexBreakdown;
  mortgage: MortgageBreakdown;
  entry: Entry;
  benchmark: BenchmarkBreakdown;
  yields: Yields | null;
  risk: RiskScores;
  advisor?: AdvisorVerdict;
}
