import React from "react";

/**
 * Meta Mensal $100 — Anel de progresso + pace diário + barra.
 *
 * Filosofia: o objetivo NÃO é teto. É piso. Ultrapassar é bônus.
 *   - Anel circular: progresso mensal atual vs $100
 *   - Pace: $3.33/dia esperado. Exibe linha + status ON_TRACK/BEHIND/AT_RISK
 *   - Barra: progresso visual rápido
 */
export function GoalProgress({ goalProgress, dailyRisk }) {
  const g = goalProgress;
  if (!g) return <GoalSkeleton />;

  const pct      = Math.max(0, Math.min(200, g.progressPct)); // clamp 0..200 for overflow display
  const reached  = g.reached;
  const overflow = g.monthlyPnl > g.floor ? g.monthlyPnl - g.floor : 0;

  const paceColor =
    g.paceStatus === "ON_TRACK" ? "text-positive"
    : g.paceStatus === "BEHIND" ? "text-warning"
    : "text-negative";

  const paceBadge =
    g.paceStatus === "ON_TRACK" ? "EM LINHA"
    : g.paceStatus === "BEHIND" ? "ATRÁS"
    : "EM RISCO";

  // Ring geometry
  const size   = 140;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circ   = 2 * Math.PI * radius;
  const displayPct = Math.min(100, pct);
  const offset = circ * (1 - displayPct / 100);

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xs text-muted tracking-[0.15em] font-medium">META MENSAL</h2>
          <p className="text-[10px] text-muted-dim mt-0.5">Piso mínimo — sem teto superior</p>
        </div>
        <span className={`px-2 py-1 rounded text-[10px] font-semibold tracking-wider border ${
          reached
            ? "border-positive/40 bg-positive/10 text-positive"
            : g.paceStatus === "ON_TRACK"
              ? "border-positive/40 bg-positive/10 text-positive"
              : g.paceStatus === "BEHIND"
                ? "border-warning/40 bg-warning/10 text-warning"
                : "border-negative/40 bg-negative/10 text-negative"
        }`}>
          {reached ? "✓ ATINGIDA" : paceBadge}
        </span>
      </div>

      <div className="flex items-center gap-5">
        {/* Ring */}
        <div className="relative" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={stroke}
              className="text-border"
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={stroke}
              strokeDasharray={circ}
              strokeDashoffset={offset}
              strokeLinecap="round"
              className={reached ? "text-positive" : "text-accent"}
              style={{ transition: "stroke-dashoffset 600ms ease-out" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className={`text-2xl font-bold font-mono ${reached ? "text-positive" : "text-accent"}`}>
              {pct.toFixed(0)}%
            </div>
            <div className="text-[10px] text-muted mt-0.5">de $100</div>
          </div>
        </div>

        {/* Stats */}
        <div className="flex-1 space-y-2.5">
          <StatLine
            label="P&L do mês"
            value={`${g.monthlyPnl >= 0 ? "+" : ""}$${g.monthlyPnl.toFixed(2)}`}
            valueColor={g.monthlyPnl >= 0 ? "text-positive" : "text-negative"}
          />
          <StatLine
            label={`Pace esperado (dia ${g.dayOfMonth})`}
            value={`$${g.expectedPace.toFixed(2)}`}
            valueColor="text-text-dim"
          />
          <StatLine
            label="Dias restantes"
            value={`${g.daysRemaining}d`}
            valueColor="text-text-dim"
          />
          <StatLine
            label="Trades no mês"
            value={`${g.tradeCount} (${g.winRate}% WR)`}
            valueColor="text-text"
          />
        </div>
      </div>

      {overflow > 0 && (
        <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs">
          <span className="text-muted">Bônus acima da meta</span>
          <span className="font-mono font-bold text-positive">+${overflow.toFixed(2)}</span>
        </div>
      )}

      {!reached && g.paceStatus === "AT_RISK" && g.daysRemaining > 0 && (
        <div className="mt-4 pt-3 border-t border-border">
          <div className="text-xs text-warning mb-1.5">Para cumprir a meta:</div>
          <div className="text-xs text-text-dim">
            Precisa de <span className="text-warning font-mono font-bold">
              ${((g.floor - g.monthlyPnl) / g.daysRemaining).toFixed(2)}/dia
            </span> nos próximos {g.daysRemaining} dias
          </div>
        </div>
      )}
    </div>
  );
}

function StatLine({ label, value, valueColor }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted">{label}</span>
      <span className={`font-mono font-semibold ${valueColor}`}>{value}</span>
    </div>
  );
}

function GoalSkeleton() {
  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-card">
      <div className="h-4 bg-border rounded w-1/3 mb-4 animate-pulse" />
      <div className="flex gap-5">
        <div className="w-[140px] h-[140px] rounded-full bg-border/50 animate-pulse" />
        <div className="flex-1 space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-3 bg-border rounded animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
