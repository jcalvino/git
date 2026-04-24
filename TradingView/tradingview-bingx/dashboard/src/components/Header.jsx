import React from "react";

/**
 * Header — barra superior consolidada estilo Bloomberg terminal.
 * Mostra: marca/mode, KPIs principais (equity, P&L mês vs meta, pace, WR),
 * preços dos ativos principais, timestamp de última atualização, refresh.
 */
export function Header({ overview, lastUpdate, onRefresh, mode, goalProgress, dailyRisk, openTradesCount = 0 }) {
  const prices   = overview?.prices ?? {};
  const balance  = overview?.balance ?? {};
  const isLive   = mode === "live";

  const monthlyPnl = goalProgress?.monthlyPnl ?? 0;
  const floor      = goalProgress?.floor ?? 100;
  const progressPct = goalProgress?.progressPct ?? 0;
  const paceStatus  = goalProgress?.paceStatus;
  const winRate     = goalProgress?.winRate;

  const paceColor =
    paceStatus === "ON_TRACK" ? "text-positive"
    : paceStatus === "BEHIND" ? "text-warning"
    : paceStatus === "AT_RISK" ? "text-negative"
    : "text-muted";

  const dailyPnl   = dailyRisk?.dailyPnl ?? 0;

  return (
    <header className="bg-card border-b border-border shadow-card">
      {/* Top row — brand, mode, equity, refresh */}
      <div className="flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isLive ? "bg-positive shadow-glow" : "bg-accent"} animate-pulse`} />
            <span className="text-accent font-semibold text-sm tracking-[0.2em]">
              BINGX TRADER
            </span>
          </div>
          <span className="text-border">|</span>
          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold tracking-wider border ${
            isLive
              ? "border-positive/40 bg-positive/10 text-positive"
              : "border-accent/40 bg-accent/10 text-accent"
          }`}>
            {isLive ? "LIVE" : "PAPER"}
          </span>
          {openTradesCount > 0 && (
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold tracking-wider border border-accent-alt/40 bg-accent-alt/10 text-accent-alt font-mono">
              {openTradesCount} OPEN
            </span>
          )}
        </div>

        <div className="flex items-center gap-4 text-xs">
          {lastUpdate && (
            <span className="text-muted font-mono text-[11px]">
              {lastUpdate.toLocaleTimeString("pt-BR")}
            </span>
          )}
          <button
            onClick={onRefresh}
            className="px-2 py-1 text-xs border border-border rounded hover:border-accent hover:text-accent transition-colors"
            title="Atualizar"
          >
            ↺
          </button>
        </div>
      </div>

      {/* Bottom row — KPI strip */}
      <div className="flex items-stretch border-t border-border/50 text-xs">
        <KpiCell
          label="EQUITY"
          value={balance.total !== undefined ? `$${balance.total.toFixed(2)}` : "—"}
          valueColor="text-accent"
        />
        <KpiCell
          label={`P&L MÊS / $${floor}`}
          value={`${monthlyPnl >= 0 ? "+" : ""}$${monthlyPnl.toFixed(2)}`}
          valueColor={monthlyPnl >= 0 ? "text-positive" : "text-negative"}
          sub={`${progressPct.toFixed(0)}% · ${paceStatus === "ON_TRACK" ? "em linha" : paceStatus === "BEHIND" ? "atrás" : paceStatus === "AT_RISK" ? "em risco" : "—"}`}
          subColor={paceColor}
        />
        <KpiCell
          label="P&L HOJE"
          value={`${dailyPnl >= 0 ? "+" : ""}$${dailyPnl.toFixed(2)}`}
          valueColor={dailyPnl >= 0 ? "text-positive" : "text-negative"}
          sub={dailyRisk?.limited ? "circuit breaker ativo" : "limite: -$" + (dailyRisk?.limitAmount?.toFixed(2) ?? "—")}
          subColor={dailyRisk?.limited ? "text-negative" : "text-muted-dim"}
        />
        <KpiCell
          label="WIN RATE"
          value={winRate !== undefined ? `${winRate}%` : "—"}
          valueColor={(winRate ?? 0) >= 55 ? "text-positive" : (winRate ?? 0) >= 40 ? "text-warning" : "text-text-dim"}
          sub={goalProgress?.tradeCount !== undefined ? `${goalProgress.tradeCount} trades/mês` : ""}
        />
        {(prices.BTCUSDC ?? prices.BTCUSDT) && (
          <KpiCell
            label="BTC"
            value={`$${Number(prices.BTCUSDC ?? prices.BTCUSDT).toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
            valueColor="text-text"
          />
        )}
        {(prices.ETHUSDC ?? prices.ETHUSDT) && (
          <KpiCell
            label="ETH"
            value={`$${Number(prices.ETHUSDC ?? prices.ETHUSDT).toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
            valueColor="text-text"
          />
        )}
        {(prices.SOLUSDC ?? prices.SOLUSDT) && (
          <KpiCell
            label="SOL"
            value={`$${Number(prices.SOLUSDC ?? prices.SOLUSDT).toFixed(2)}`}
            valueColor="text-text"
          />
        )}
      </div>
    </header>
  );
}

function KpiCell({ label, value, valueColor = "text-text", sub, subColor = "text-muted-dim" }) {
  return (
    <div className="flex-1 min-w-[140px] px-4 py-2 border-r border-border/50 last:border-r-0">
      <div className="text-[10px] text-muted-dim tracking-[0.15em] font-medium">{label}</div>
      <div className={`text-sm font-mono font-bold ${valueColor} mt-0.5`}>{value}</div>
      {sub && <div className={`text-[10px] mt-0.5 ${subColor}`}>{sub}</div>}
    </div>
  );
}
