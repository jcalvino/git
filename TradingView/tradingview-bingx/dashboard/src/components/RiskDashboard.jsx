import React from "react";

/**
 * RiskDashboard — painel consolidado de risco em tempo real.
 * Mostra: uso do limite diário, capital em risco, posições abertas, margem de segurança.
 *
 * Props:
 *   dailyRisk:   { dailyPnl, limitAmount, usagePct, limited, dailyProfit, profitReference }
 *   goalProgress:{ monthlyPnl, floor, expectedPace, paceStatus, daysRemaining }
 *   overview:    { balance, openPositions? }
 *   openTrades:  [{ symbol, direction, size, entry_price, sl_price, ... }]
 */
export function RiskDashboard({ dailyRisk, goalProgress, overview, openTrades = [] }) {
  const equity = overview?.balance?.total ?? 0;

  const dailyPnl   = dailyRisk?.dailyPnl ?? 0;
  const dailyLimit = dailyRisk?.limitAmount ?? 0;
  const usagePct   = dailyRisk?.usagePct
    ?? (dailyLimit > 0 ? Math.min(100, Math.max(0, (Math.abs(Math.min(0, dailyPnl)) / dailyLimit) * 100)) : 0);

  // Capital em risco = soma das distâncias (entry→sl) × size
  const capitalAtRisk = openTrades.reduce((acc, t) => {
    if (!t.entry_price || !t.sl_price || !t.size) return acc;
    const riskPerUnit = Math.abs(t.entry_price - t.sl_price);
    return acc + riskPerUnit * t.size;
  }, 0);

  const riskPctOfEquity = equity > 0 ? (capitalAtRisk / equity) * 100 : 0;

  const dailyUsageColor =
    usagePct >= 80 ? "bg-negative"
    : usagePct >= 50 ? "bg-warning"
    : "bg-positive";

  const riskColor =
    riskPctOfEquity >= 3  ? "text-negative"
    : riskPctOfEquity >= 1.5 ? "text-warning"
    : "text-positive";

  const paceColor =
    goalProgress?.paceStatus === "ON_TRACK" ? "text-positive"
    : goalProgress?.paceStatus === "BEHIND" ? "text-warning"
    : "text-negative";

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xs text-muted tracking-[0.15em] font-medium">RISK CONTROL</h2>
          <p className="text-[10px] text-muted-dim mt-0.5">
            Monitoramento em tempo real — stop loss circuit breaker
          </p>
        </div>
        {dailyRisk?.limited && (
          <span className="px-2 py-1 rounded text-[10px] font-semibold tracking-wider border border-negative/40 bg-negative/10 text-negative animate-pulse">
            LIMITE ATINGIDO
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Uso do limite diário */}
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[10px] text-muted-dim tracking-wider">LIMITE DIÁRIO</span>
            <span className={`text-[10px] font-mono ${usagePct >= 80 ? "text-negative" : usagePct >= 50 ? "text-warning" : "text-positive"}`}>
              {usagePct.toFixed(0)}%
            </span>
          </div>
          <div className="h-1.5 rounded-sm bg-border/50 overflow-hidden">
            <div className={`h-full ${dailyUsageColor} transition-all`} style={{ width: `${Math.min(100, usagePct)}%` }} />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between text-[10px]">
            <span className="text-muted">
              <span className={`font-mono font-bold ${dailyPnl >= 0 ? "text-positive" : "text-negative"}`}>
                {dailyPnl >= 0 ? "+" : ""}${dailyPnl.toFixed(2)}
              </span>
            </span>
            <span className="text-muted-dim font-mono">
              / -${dailyLimit.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Capital em risco */}
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[10px] text-muted-dim tracking-wider">CAPITAL EM RISCO</span>
            <span className={`text-[10px] font-mono ${riskColor}`}>
              {riskPctOfEquity.toFixed(2)}%
            </span>
          </div>
          <div className={`text-sm font-mono font-bold ${riskColor}`}>
            ${capitalAtRisk.toFixed(2)}
          </div>
          <div className="mt-1.5 text-[10px] text-muted-dim">
            {openTrades.length} posiç{openTrades.length === 1 ? "ão" : "ões"} aberta{openTrades.length === 1 ? "" : "s"}
            · equity ${equity.toFixed(2)}
          </div>
        </div>

        {/* Meta mensal */}
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[10px] text-muted-dim tracking-wider">META MENSAL</span>
            <span className={`text-[10px] font-mono font-semibold ${paceColor}`}>
              {goalProgress?.paceStatus === "ON_TRACK" ? "EM LINHA" : goalProgress?.paceStatus === "BEHIND" ? "ATRÁS" : goalProgress?.paceStatus === "AT_RISK" ? "EM RISCO" : "—"}
            </span>
          </div>
          <div className={`text-sm font-mono font-bold ${(goalProgress?.monthlyPnl ?? 0) >= 0 ? "text-positive" : "text-negative"}`}>
            {(goalProgress?.monthlyPnl ?? 0) >= 0 ? "+" : ""}${(goalProgress?.monthlyPnl ?? 0).toFixed(2)}
          </div>
          <div className="mt-1.5 text-[10px] text-muted-dim">
            piso ${goalProgress?.floor ?? 100} · pace ${(goalProgress?.expectedPace ?? 0).toFixed(2)}
          </div>
        </div>

        {/* Dias restantes */}
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[10px] text-muted-dim tracking-wider">DIAS RESTANTES</span>
          </div>
          <div className="text-sm font-mono font-bold text-text">
            {goalProgress?.daysRemaining ?? "—"}d
          </div>
          <div className="mt-1.5 text-[10px] text-muted-dim">
            {goalProgress?.daysRemaining > 0 && goalProgress?.floor && (goalProgress?.monthlyPnl ?? 0) < goalProgress.floor ? (
              <>
                Precisa{" "}
                <span className="text-warning font-mono">
                  ${((goalProgress.floor - goalProgress.monthlyPnl) / goalProgress.daysRemaining).toFixed(2)}/dia
                </span>
              </>
            ) : (
              <>Meta no alvo</>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
