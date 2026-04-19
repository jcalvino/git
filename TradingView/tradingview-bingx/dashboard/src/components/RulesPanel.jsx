// ─────────────────────────────────────────────────────────────────
//  Regras — Strategy Engine Viewer
//  Shows the active trading setups, risk parameters, and the
//  knowledge base (updated via "Base de conhecimento:" prompts).
// ─────────────────────────────────────────────────────────────────

export function RulesPanel({ strategy, knowledgeBase }) {
  const setups   = strategy?.setups   ?? {};
  const strat    = strategy?.strategy ?? {};
  const setupList = Object.values(setups);

  return (
    <div className="space-y-6">

      {/* ── Risk Parameters ── */}
      <section>
        <h2 className="text-xs font-semibold text-muted tracking-widest mb-3">
          PARÂMETROS DE RISCO
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <ParamCard label="Risco / trade"     value={`${((strat.SL_PCT ?? 0.005) * 100).toFixed(1)}%`}           note="SL padrão" />
          <ParamCard label="Risco diário"       value={`${((strat.DAILY_RISK_PCT ?? 0.01) * 100).toFixed(0)}%`}    note="do capital" />
          <ParamCard label="Meta diária"        value={`$${strat.DAILY_PROFIT_TARGET ?? "—"}`}                     note="bot pausa ao atingir" />
          <ParamCard label="Capital reserva"    value={`${((strat.MIN_FREE_CAPITAL_PCT ?? 0.20) * 100).toFixed(0)}%`} note="sempre livre" />
          <ParamCard label="Alocação/slot"      value={`${((strat.CAPITAL_ALLOCATION_PCT ?? 0.20) * 100).toFixed(0)}%`} note="do capital" />
        </div>
      </section>

      {/* ── Take-Profit Levels ── */}
      <section>
        <h2 className="text-xs font-semibold text-muted tracking-widest mb-3">
          DISTRIBUIÇÃO DE TAKE-PROFIT (FIBONACCI)
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <ParamCard label="TP1 — Fib 1.618R" value={`${((strat.TP_DISTRIBUTION?.TP1 ?? 0.40) * 100).toFixed(0)}% da posição`} note={`R: ${strat.FIB_LEVELS?.TP1 ?? 1.618}`} color="text-positive" />
          <ParamCard label="TP2 — Fib 2.618R" value={`${((strat.TP_DISTRIBUTION?.TP2 ?? 0.35) * 100).toFixed(0)}% da posição`} note={`R: ${strat.FIB_LEVELS?.TP2 ?? 2.618}`} color="text-positive" />
          <ParamCard label="TP3 — Fib 4.236R" value={`${((strat.TP_DISTRIBUTION?.TP3 ?? 0.25) * 100).toFixed(0)}% restante`}  note={`R: ${strat.FIB_LEVELS?.TP3 ?? 4.236}`} color="text-positive" />
        </div>
      </section>

      {/* ── Ativos ── */}
      <section>
        <h2 className="text-xs font-semibold text-muted tracking-widest mb-3">
          ATIVOS MONITORADOS ({(strat.SYMBOLS ?? []).length})
        </h2>
        <div className="flex flex-wrap gap-2">
          {(strat.SYMBOLS ?? []).map((s) => {
            const cfg = strat.SYMBOL_CONFIG?.[s];
            return (
              <span
                key={s}
                className={`px-2 py-1 rounded text-xs font-mono border ${
                  cfg?.enabled === false
                    ? "border-border text-muted line-through"
                    : "border-accent/30 text-accent bg-accent/5"
                }`}
              >
                {s}
              </span>
            );
          })}
        </div>
      </section>

      {/* ── Setups ── */}
      <section>
        <h2 className="text-xs font-semibold text-muted tracking-widest mb-3">
          SETUPS DE ENTRADA ({setupList.length})
        </h2>
        <div className="space-y-3">
          {setupList.map((setup) => (
            <SetupCard key={setup.id} setup={setup} />
          ))}
          {setupList.length === 0 && (
            <p className="text-xs text-muted">Aguardando servidor…</p>
          )}
        </div>
      </section>

      {/* ── Knowledge Base ── */}
      <section>
        <h2 className="text-xs font-semibold text-muted tracking-widest mb-3">
          BASE DE CONHECIMENTO
        </h2>
        <div className="rounded-lg border border-border bg-card p-4">
          {knowledgeBase ? (
            <KnowledgeBaseRenderer content={knowledgeBase} />
          ) : (
            <p className="text-xs text-muted">
              Nenhuma entrada ainda. Envie uma mensagem começando com{" "}
              <span className="text-accent font-mono">"Base de conhecimento"</span>{" "}
              para adicionar análises, indicadores, e novas regras.
            </p>
          )}
        </div>
      </section>

    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────

function ParamCard({ label, value, note, color = "text-text" }) {
  return (
    <div className="bg-card border border-border rounded-lg p-3 space-y-1">
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-lg font-bold font-mono ${color}`}>{value}</div>
      {note && <div className="text-xs text-muted/70">{note}</div>}
    </div>
  );
}

function SetupCard({ setup }) {
  const enabled = setup.enabled !== false;

  return (
    <div className={`rounded-lg border p-4 space-y-2 ${
      enabled ? "border-border bg-card" : "border-border/40 bg-card/50 opacity-60"
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold text-text">{setup.name}</h3>
          <p className="text-xs text-muted">{setup.description}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          {!enabled && (
            <span className="px-2 py-0.5 rounded text-xs bg-border/30 text-muted">DISABLED</span>
          )}
          {setup.direction && (
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${
              setup.direction === "SHORT"
                ? "bg-negative/20 text-negative"
                : "bg-positive/20 text-positive"
            }`}>
              {setup.direction} ONLY
            </span>
          )}
          {setup.filterOnly && (
            <span className="px-2 py-0.5 rounded text-xs bg-accent/10 text-accent">FILTRO</span>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <StatBadge label="Leverage"  value={`${setup.leverage ?? 1}x`}   color="text-accent" />
        <StatBadge label="SL"        value={`${((setup.sl_pct ?? 0.005) * 100).toFixed(1)}%`} color="text-negative" />
        <StatBadge label="TP1"       value={`${setup.tp_r?.tp1 ?? 1.618}R`} color="text-positive" />
        <StatBadge label="TP2/TP3"   value={`${setup.tp_r?.tp2 ?? 2.618}R / ${setup.tp_r?.tp3 ?? 4.236}R`} color="text-positive" />
      </div>

      {/* Symbols restriction */}
      {setup.symbols && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-xs text-muted">Símbolos:</span>
          {setup.symbols.map((s) => (
            <span key={s} className="text-xs font-mono text-accent bg-accent/10 px-1.5 py-0.5 rounded">{s}</span>
          ))}
        </div>
      )}

      {/* Extra thresholds */}
      <SetupExtras setup={setup} />
    </div>
  );
}

function StatBadge({ label, value, color }) {
  return (
    <div className="flex items-center gap-1.5 bg-bg/60 rounded px-2 py-1">
      <span className="text-muted">{label}:</span>
      <span className={`font-mono font-semibold ${color}`}>{value}</span>
    </div>
  );
}

function SetupExtras({ setup }) {
  const extras = [];
  if (setup.ema_touch_pct)           extras.push(`Zona EMA21: ±${(setup.ema_touch_pct * 100).toFixed(1)}%`);
  if (setup.touch_pct)               extras.push(`Proximidade STH: ≤${(setup.touch_pct * 100).toFixed(0)}%`);
  if (setup.converge_threshold_pct)  extras.push(`Convergência mínima: ${setup.converge_threshold_pct}pp`);
  if (setup.retest_tolerance_pct)    extras.push(`Tolerância reteste: ±${(setup.retest_tolerance_pct * 100).toFixed(1)}%`);
  if (setup.min_touches)             extras.push(`Toques mínimos S/R: ${setup.min_touches}`);
  if (setup.oi_change_threshold)     extras.push(`OI mudança mínima: ${setup.oi_change_threshold}%`);
  if (setup.zone_dominance_threshold) extras.push(`Dominância de zona: ≥${(setup.zone_dominance_threshold * 100).toFixed(0)}%`);

  if (extras.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {extras.map((e) => (
        <span key={e} className="text-xs text-muted bg-bg/80 border border-border/50 rounded px-2 py-0.5">{e}</span>
      ))}
    </div>
  );
}

// Simple markdown renderer — only handles headings and paragraphs
function KnowledgeBaseRenderer({ content }) {
  const sections = content.split(/\n(?=#{1,3} )/);

  return (
    <div className="space-y-4 text-xs">
      {sections.map((section, i) => {
        const lines = section.trim().split("\n");
        const heading = lines[0];
        const body    = lines.slice(1).join("\n").trim();

        if (heading.startsWith("# ")) {
          return (
            <div key={i}>
              <h3 className="text-sm font-bold text-text mb-2">{heading.replace(/^#+\s*/, "")}</h3>
              {body && <p className="text-muted leading-relaxed whitespace-pre-wrap">{body}</p>}
            </div>
          );
        }
        if (heading.startsWith("## ")) {
          return (
            <div key={i} className="border-l-2 border-accent/30 pl-3">
              <h4 className="font-semibold text-text mb-1">{heading.replace(/^#+\s*/, "")}</h4>
              {body && <p className="text-muted leading-relaxed whitespace-pre-wrap">{body}</p>}
            </div>
          );
        }
        if (heading.startsWith("### ")) {
          return (
            <div key={i} className="pl-1">
              <h5 className="font-medium text-muted mb-0.5">{heading.replace(/^#+\s*/, "")}</h5>
              {body && <p className="text-muted/80 leading-relaxed whitespace-pre-wrap">{body}</p>}
            </div>
          );
        }
        return (
          <p key={i} className="text-muted leading-relaxed whitespace-pre-wrap">
            {section.trim()}
          </p>
        );
      })}
    </div>
  );
}
