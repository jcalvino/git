import React, { useMemo } from "react";

/**
 * CloseReasonDonut — donut SVG com a distribuição de fechamentos.
 * Categorias: TP1, TP2, TP3, SL, BREAK_EVEN, MANUAL, TRAIL.
 *
 * Props:
 *   closeReasons: [{ reason, count, totalPnl }]
 */
export function CloseReasonDonut({ closeReasons = [] }) {
  const { slices, total, totalPnl } = useMemo(() => {
    const total = closeReasons.reduce((s, r) => s + (r.count || 0), 0);
    const totalPnl = closeReasons.reduce((s, r) => s + (r.totalPnl || 0), 0);
    if (!total) return { slices: [], total: 0, totalPnl: 0 };

    const colorMap = {
      TP1:        { fill: "#00A850", label: "TP1" },
      TP2:        { fill: "#00E676", label: "TP2" },
      TP3:        { fill: "#7B61FF", label: "TP3" },
      SL:         { fill: "#FF3D57", label: "SL" },
      BREAK_EVEN: { fill: "#00D4FF", label: "BE" },
      TRAIL:      { fill: "#FFB020", label: "TRAIL" },
      MANUAL:     { fill: "#6B7280", label: "MANUAL" },
    };

    let cumulative = 0;
    const slices = closeReasons.map((r) => {
      const meta = colorMap[r.reason] || { fill: "#6B7280", label: r.reason };
      const pct = (r.count / total) * 100;
      const startAngle = (cumulative / total) * 2 * Math.PI;
      const endAngle   = ((cumulative + r.count) / total) * 2 * Math.PI;
      cumulative += r.count;
      return { ...r, ...meta, pct, startAngle, endAngle };
    });
    return { slices, total, totalPnl };
  }, [closeReasons]);

  if (!total) {
    return (
      <div className="bg-card border border-border rounded-xl p-5 shadow-card">
        <h2 className="text-xs text-muted tracking-[0.15em] font-medium mb-4">MOTIVO DE FECHAMENTO</h2>
        <p className="text-xs text-muted-dim">Sem trades fechados ainda.</p>
      </div>
    );
  }

  const size = 140;
  const outer = 60;
  const inner = 38;
  const cx = size / 2;
  const cy = size / 2;

  const describeArc = (r1, r2, startAngle, endAngle) => {
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    const x1 = cx + r1 * Math.sin(startAngle);
    const y1 = cy - r1 * Math.cos(startAngle);
    const x2 = cx + r1 * Math.sin(endAngle);
    const y2 = cy - r1 * Math.cos(endAngle);
    const x3 = cx + r2 * Math.sin(endAngle);
    const y3 = cy - r2 * Math.cos(endAngle);
    const x4 = cx + r2 * Math.sin(startAngle);
    const y4 = cy - r2 * Math.cos(startAngle);
    return `M${x1},${y1} A${r1},${r1} 0 ${largeArc},1 ${x2},${y2} L${x3},${y3} A${r2},${r2} 0 ${largeArc},0 ${x4},${y4} Z`;
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-card">
      <div className="mb-4">
        <h2 className="text-xs text-muted tracking-[0.15em] font-medium">MOTIVO DE FECHAMENTO</h2>
        <p className="text-[10px] text-muted-dim mt-0.5">{total} trades fechados</p>
      </div>

      <div className="flex items-center gap-5">
        <div className="relative" style={{ width: size, height: size }}>
          <svg width={size} height={size}>
            {slices.map((s, i) => (
              <path
                key={s.reason}
                d={describeArc(outer, inner, s.startAngle, s.endAngle)}
                fill={s.fill}
                opacity="0.9"
                className="transition-opacity hover:opacity-100"
              >
                <title>{`${s.label}: ${s.count} (${s.pct.toFixed(1)}%) — $${s.totalPnl.toFixed(2)}`}</title>
              </path>
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className={`text-xl font-bold font-mono ${totalPnl >= 0 ? "text-positive" : "text-negative"}`}>
              {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(0)}
            </div>
            <div className="text-[10px] text-muted mt-0.5">total</div>
          </div>
        </div>

        <div className="flex-1 space-y-1.5">
          {slices.map((s) => (
            <div key={s.reason} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.fill }} />
                <span className="text-text">{s.label}</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-text-dim">{s.count}</span>
                <span className="font-mono text-[10px] text-muted-dim w-10 text-right">
                  {s.pct.toFixed(0)}%
                </span>
                <span className={`font-mono text-[10px] w-14 text-right ${s.totalPnl >= 0 ? "text-positive" : "text-negative"}`}>
                  {s.totalPnl >= 0 ? "+" : ""}${s.totalPnl.toFixed(1)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
