export interface AnalyzeRequest {
  url: string;
  financing: {
    ltv: number;
    annualRatePct: number;
    years: number;
  };
  use: "HPP" | "INVESTMENT";
}

export interface FiscalResult {
  imtEUR: number;
  stamp: { acquisitionEUR: number; mortgageEUR: number; totalEUR: number };
  fixedCostsEUR: number;
  totalFiscalEUR: number;
}

export interface CapexResult {
  level: string;
  ratePerM2EUR: number;
  baseWorksEUR: number;
  contingencyEUR: number;
  licensingEUR: number;
  ivaRate: number;
  ivaEUR: number;
  totalCapexEUR: number;
}

export interface MortgageResult {
  principalEUR: number;
  downpaymentEUR: number;
  monthlyInstallmentEUR: number;
  totalInterestEUR: number;
  holdingCost6mEUR: number;
}

export interface YieldsResult {
  grossPct: number;
  netPct: number;
  cashOnCashPct: number;
  grossAnnualEUR: number;
  netAnnualEUR: number;
}

export interface RiskResult {
  flipRisk: number;
  rentRisk: number;
  notes: string[];
}

export interface BenchmarkResult {
  propertyPricePerM2EUR: number;
  regionalMedianPerM2EUR: number | null;
  deltaPct: number | null;
}

export interface PropertyResult {
  priceEUR: number;
  areaM2: number;
  typology: string;
  freguesia: string;
  energyCert: string;
  condition: string;
  isInARU: boolean;
  propertyType: string;
  sourceUrl: string;
  source: string;
  yearBuilt?: number;
  bedrooms?: number;
  bathrooms?: number;
}

export interface AnalysisSummary {
  property: PropertyResult;
  fiscal: FiscalResult;
  capexWorstCase: CapexResult;
  mortgage: MortgageResult;
  entry: { realEntryCostEUR: number; totalAcquisitionCostEUR: number };
  benchmark: BenchmarkResult;
  yields: YieldsResult | null;
  risk: RiskResult;
}

export type AppState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: AnalysisSummary }
  | { status: "error"; message: string };
