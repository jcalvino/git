import type { AnalysisSummary } from "../types";

const eur = (n: number) =>
  n.toLocaleString("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

const pct = (n: number) => `${n.toFixed(2)}%`;

function riskClass(score: number) {
  if (score <= 3) return "low";
  if (score <= 6) return "mid";
  return "high";
}

const COND_LABEL: Record<string, string> = {
  L1_COSMETIC: "L1 · Cosmético",
  L2_STANDARD: "L2 · Standard",
  L3_STRUCTURAL: "L3 · Estrutural",
  UNKNOWN: "Desconhecido",
};

const SOURCE_LABEL: Record<string, string> = {
  IDEALISTA: "Idealista",
  IMOVIRTUAL: "Imovirtual",
  CASA_SAPO: "Casa Sapo",
  CASAYES: "CasaYes",
  QUATRU: "Quatru",
  MANUAL_PROSPECTUS: "Manual",
};

interface Props {
  data: AnalysisSummary;
}

export function ResultCard({ data }: Props) {
  const { property, fiscal, capexWorstCase, mortgage, entry, benchmark, yields, risk } = data;

  return (
    <div className="result-card">
      {/* ── Header ── */}
      <div className="result-header">
        <div className="result-header-left">
          <h2>
            {property.typology} · {property.freguesia}
          </h2>
          <div className="sub">
            {property.areaM2} m²
            {property.bedrooms != null && ` · ${property.bedrooms} quartos`}
            {property.yearBuilt && ` · ${property.yearBuilt}`}
          </div>
          <div className="tags-row" style={{ marginTop: 8 }}>
            <span className="tag tag-blue">{property.energyCert}</span>
            <span className="tag tag-gray">{COND_LABEL[property.condition] ?? property.condition}</span>
            {property.isInARU && <span className="tag tag-green">ARU</span>}
            <span className="tag tag-gray">{SOURCE_LABEL[property.source] ?? property.source}</span>
          </div>
          <a
            href={property.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="source-link"
            style={{ marginTop: 6, display: "inline-block" }}
          >
            Ver anúncio original ↗
          </a>
        </div>
        <div className="price-badge">{eur(property.priceEUR)}</div>
      </div>

      {/* ── KPI Strip ── */}
      <div className="kpi-strip">
        <div className="kpi">
          <div className="kpi-label">Custo de entrada</div>
          <div className="kpi-value">{eur(entry.realEntryCostEUR)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Prestação mensal</div>
          <div className="kpi-value">{eur(mortgage.monthlyInstallmentEUR)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Yield bruto</div>
          <div className="kpi-value">
            {yields ? pct(yields.grossPct) : "—"}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">€ / m²</div>
          <div className="kpi-value">{eur(benchmark.propertyPricePerM2EUR)}</div>
        </div>
      </div>

      <div className="sections">
        {/* ── Risk ── */}
        <div className="section">
          <div className="section-title">Risco</div>
          <div className="risk-grid">
            <div className={`risk-box ${riskClass(risk.flipRisk)}`}>
              <div>
                <div className="risk-label">Flip</div>
                <div style={{ fontSize: ".78rem", color: "var(--muted)" }}>Revenda</div>
              </div>
              <div className="risk-score">{risk.flipRisk}<span style={{ fontSize: ".9rem" }}>/10</span></div>
            </div>
            <div className={`risk-box ${riskClass(risk.rentRisk)}`}>
              <div>
                <div className="risk-label">Arrendamento</div>
                <div style={{ fontSize: ".78rem", color: "var(--muted)" }}>Renda</div>
              </div>
              <div className="risk-score">{risk.rentRisk}<span style={{ fontSize: ".9rem" }}>/10</span></div>
            </div>
          </div>
          {risk.notes.map((note, i) => (
            <div key={i} className="risk-note">{note}</div>
          ))}
        </div>

        {/* ── Fiscal ── */}
        <div className="section">
          <div className="section-title">Fiscal</div>
          <div className="row">
            <span className="row-label">IMT</span>
            <span className="row-value">{eur(fiscal.imtEUR)}</span>
          </div>
          <div className="row">
            <span className="row-label">Imposto de Selo aquisição</span>
            <span className="row-value">{eur(fiscal.stamp.acquisitionEUR)}</span>
          </div>
          <div className="row">
            <span className="row-label">Imposto de Selo hipoteca</span>
            <span className="row-value">{eur(fiscal.stamp.mortgageEUR)}</span>
          </div>
          <div className="row">
            <span className="row-label">Custos fixos (escritura, registo)</span>
            <span className="row-value">{eur(fiscal.fixedCostsEUR)}</span>
          </div>
          <div className="row total">
            <span className="row-label">Total fiscal</span>
            <span className="row-value">{eur(fiscal.totalFiscalEUR)}</span>
          </div>
        </div>

        {/* ── CAPEX ── */}
        <div className="section">
          <div className="section-title">CAPEX · pior caso</div>
          <div className="row">
            <span className="row-label">Nível estimado</span>
            <span className="row-value">{COND_LABEL[capexWorstCase.level] ?? capexWorstCase.level}</span>
          </div>
          <div className="row">
            <span className="row-label">Obras base ({eur(capexWorstCase.ratePerM2EUR)}/m²)</span>
            <span className="row-value">{eur(capexWorstCase.baseWorksEUR)}</span>
          </div>
          <div className="row">
            <span className="row-label">Contingência 20%</span>
            <span className="row-value">{eur(capexWorstCase.contingencyEUR)}</span>
          </div>
          <div className="row">
            <span className="row-label">Licenciamento</span>
            <span className="row-value">{eur(capexWorstCase.licensingEUR)}</span>
          </div>
          <div className="row">
            <span className="row-label">IVA {pct(capexWorstCase.ivaRate * 100)}</span>
            <span className="row-value">{eur(capexWorstCase.ivaEUR)}</span>
          </div>
          <div className="row total">
            <span className="row-label">Total CAPEX</span>
            <span className="row-value">{eur(capexWorstCase.totalCapexEUR)}</span>
          </div>
        </div>

        {/* ── Mortgage ── */}
        <div className="section">
          <div className="section-title">Financiamento</div>
          <div className="row">
            <span className="row-label">Capital em dívida</span>
            <span className="row-value">{eur(mortgage.principalEUR)}</span>
          </div>
          <div className="row">
            <span className="row-label">Entrada (capital próprio)</span>
            <span className="row-value">{eur(mortgage.downpaymentEUR)}</span>
          </div>
          <div className="row">
            <span className="row-label">Prestação mensal</span>
            <span className="row-value">{eur(mortgage.monthlyInstallmentEUR)}</span>
          </div>
          <div className="row">
            <span className="row-label">Juros totais</span>
            <span className="row-value">{eur(mortgage.totalInterestEUR)}</span>
          </div>
          <div className="row">
            <span className="row-label">Custo de holding 6 meses</span>
            <span className="row-value">{eur(mortgage.holdingCost6mEUR)}</span>
          </div>
        </div>

        {/* ── Benchmark ── */}
        {benchmark.regionalMedianPerM2EUR && (
          <div className="section">
            <div className="section-title">Benchmark regional</div>
            <div className="row">
              <span className="row-label">€/m² deste imóvel</span>
              <span className="row-value">{eur(benchmark.propertyPricePerM2EUR)}/m²</span>
            </div>
            <div className="row">
              <span className="row-label">Mediana regional</span>
              <span className="row-value">{eur(benchmark.regionalMedianPerM2EUR)}/m²</span>
            </div>
            {benchmark.deltaPct != null && (
              <div className="row">
                <span className="row-label">Delta vs mediana</span>
                <span
                  className={`row-value ${benchmark.deltaPct > 0 ? "delta-positive" : "delta-negative"}`}
                >
                  {benchmark.deltaPct > 0 ? "+" : ""}{pct(benchmark.deltaPct)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── Yields ── */}
        {yields && (
          <div className="section">
            <div className="section-title">Yields (arrendamento)</div>
            <div className="row">
              <span className="row-label">Renda bruta anual</span>
              <span className="row-value">{eur(yields.grossAnnualEUR)}</span>
            </div>
            <div className="row">
              <span className="row-label">Renda líquida anual (28% IRS)</span>
              <span className="row-value">{eur(yields.netAnnualEUR)}</span>
            </div>
            <div className="row">
              <span className="row-label">Yield bruto</span>
              <span className="row-value">{pct(yields.grossPct)}</span>
            </div>
            <div className="row">
              <span className="row-label">Yield líquido</span>
              <span className="row-value">{pct(yields.netPct)}</span>
            </div>
            <div className="row total">
              <span className="row-label">Cash-on-cash</span>
              <span
                className="row-value"
                style={{ color: yields.cashOnCashPct >= 0 ? "var(--success)" : "var(--danger)" }}
              >
                {pct(yields.cashOnCashPct)}
              </span>
            </div>
          </div>
        )}

        {/* ── Entry total ── */}
        <div className="section">
          <div className="section-title">Resumo de custo total</div>
          <div className="row">
            <span className="row-label">Preço do imóvel</span>
            <span className="row-value">{eur(property.priceEUR)}</span>
          </div>
          <div className="row">
            <span className="row-label">Custos fiscais</span>
            <span className="row-value">{eur(fiscal.totalFiscalEUR)}</span>
          </div>
          <div className="row">
            <span className="row-label">CAPEX pior caso</span>
            <span className="row-value">{eur(capexWorstCase.totalCapexEUR)}</span>
          </div>
          <div className="row total">
            <span className="row-label">Custo total de aquisição</span>
            <span className="row-value">{eur(entry.totalAcquisitionCostEUR)}</span>
          </div>
          <div className="row total" style={{ marginTop: 4 }}>
            <span className="row-label">Custo real de entrada (cash)</span>
            <span className="row-value">{eur(entry.realEntryCostEUR)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
