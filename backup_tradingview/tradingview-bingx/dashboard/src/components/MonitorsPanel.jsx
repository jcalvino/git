// Price Level Monitors panel — shows active monitor states in real-time.
// Data from GET /api/monitors

const STAGE_LABELS = {
  watching:       { label: "Aguardando",         color: "text-muted" },
  touched:        { label: "Nível Tocado ⚡",     color: "text-yellow-400" },
  weakness_seen:  { label: "Fraqueza Confirmada", color: "text-orange-400" },
  broke_above:    { label: "Rompimento ↑",        color: "text-accent" },
  retesting:      { label: "Retestando...",        color: "text-yellow-400" },
  triggered:      { label: "ATIVADO ✓",           color: "text-positive font-bold" },
};

const TYPE_LABELS = {
  TOUCH_WEAKNESS_ENTRY: "Toque + Fraqueza",
  BREAKOUT_RETEST:      "Rompimento + Reteste",
};

export function MonitorsPanel({ monitors = [] }) {
  if (!monitors.length) {
    return (
      <p className="text-xs text-muted">
        Nenhum monitor configurado em <code className="text-accent">monitors.json</code>.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {monitors.map((m) => {
        const stage = STAGE_LABELS[m.stage] ?? { label: m.stage, color: "text-muted" };
        const isLong = m.direction === "LONG";

        return (
          <div
            key={m.id}
            className={`rounded-lg border p-4 space-y-2 ${
              m.stage === "triggered"
                ? "border-positive/40 bg-positive/5"
                : m.stage === "watching"
                ? "border-border bg-card"
                : "border-yellow-500/30 bg-yellow-500/5"
            }`}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-text truncate">{m.name}</span>
              <span
                className={`text-xs shrink-0 px-2 py-0.5 rounded-full border ${
                  isLong
                    ? "border-positive/40 text-positive bg-positive/10"
                    : "border-negative/40 text-negative bg-negative/10"
                }`}
              >
                {m.direction}
              </span>
            </div>

            {/* Type + Symbol */}
            <div className="flex items-center gap-2 text-xs text-muted">
              <span>{m.symbol}</span>
              <span className="text-border">·</span>
              <span>{TYPE_LABELS[m.type] ?? m.type}</span>
            </div>

            {/* Stage */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">Status:</span>
              <span className={`text-xs ${stage.color}`}>{stage.label}</span>
            </div>

            {/* Levels */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mt-1">
              {m.levels?.touch && (
                <div className="text-muted">
                  Toque: <span className="text-text font-mono">${m.levels.touch.toLocaleString()}</span>
                </div>
              )}
              {m.levels?.entry && (
                <div className="text-muted">
                  Entrada: <span className="text-text font-mono">${m.levels.entry.toLocaleString()}</span>
                </div>
              )}
              {m.levels?.breakout && (
                <div className="text-muted">
                  Nível: <span className="text-text font-mono">${m.levels.breakout.toLocaleString()}</span>
                </div>
              )}
              {m.levels?.tp && (
                <div className="text-muted">
                  TPs: <span className="text-positive font-mono">{m.levels.tp.map(t => `$${t}`).join(" / ")}</span>
                </div>
              )}
              {m.levels?.reset && (
                <div className="text-muted col-span-2">
                  Reset: <span className="text-text font-mono">${m.levels.reset.toLocaleString()}</span>
                </div>
              )}
            </div>

            {/* Timestamp */}
            {(m.touchedAt || m.brokeAt || m.retestingAt || m.triggeredAt) && (
              <div className="text-xs text-muted border-t border-border pt-2">
                {m.triggeredAt && (
                  <span>Ativado: {new Date(m.triggeredAt).toLocaleTimeString()}</span>
                )}
                {!m.triggeredAt && m.retestingAt && (
                  <span>Reteste desde: {new Date(m.retestingAt).toLocaleTimeString()}</span>
                )}
                {!m.triggeredAt && !m.retestingAt && m.touchedAt && (
                  <span>Tocou às: {new Date(m.touchedAt).toLocaleTimeString()}</span>
                )}
                {!m.triggeredAt && !m.retestingAt && !m.touchedAt && m.brokeAt && (
                  <span>Rompeu às: {new Date(m.brokeAt).toLocaleTimeString()}</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
