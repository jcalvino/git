import React, { useState } from "react";

export function SignalAlert({ signals = [], onApprove, onReject }) {
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});

  const handle = async (id, action) => {
    setLoading((prev) => ({ ...prev, [id]: action }));
    setErrors((prev) => ({ ...prev, [id]: null }));
    try {
      let result;
      if (action === "approve") result = await onApprove(id);
      else result = await onReject(id);
      if (result && !result.success) {
        setErrors((prev) => ({ ...prev, [id]: result.error ?? "Unknown error" }));
      }
    } catch (err) {
      setErrors((prev) => ({ ...prev, [id]: err.message }));
    } finally {
      setLoading((prev) => ({ ...prev, [id]: null }));
    }
  };

  if (signals.length === 0) {
    return (
      <div className="text-muted text-sm text-center py-6">
        No pending signals
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {signals.map((s) => (
        <SignalCard
          key={s.id}
          signal={s}
          loading={loading[s.id]}
          error={errors[s.id]}
          onApprove={() => handle(s.id, "approve")}
          onReject={() => handle(s.id, "reject")}
        />
      ))}
    </div>
  );
}

function SignalCard({ signal: s, loading, error, onApprove, onReject }) {
  const isLong = s.direction === "LONG";

  return (
    <div
      className={`border rounded-lg p-4 ${
        isLong
          ? "border-positive/40 bg-positive/5"
          : "border-negative/40 bg-negative/5"
      }`}
    >
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <DirectionBadge direction={s.direction} />
          <span className="font-semibold text-text">{s.symbol}</span>
          {s.leverage > 1 && (
            <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
              {s.leverage}x
            </span>
          )}
          <span className="text-xs text-muted">{s.trade_type}</span>
        </div>
        <div className="flex items-center gap-2">
          <ConfidenceBadge score={s.score} />
          <span className="text-xs text-muted">
            #{s.id} · {new Date(s.created_at).toLocaleTimeString("en-US")}
          </span>
        </div>
      </div>

      {/* ── Setup Name + Rationale (collapsible) ───────────────── */}
      {s.setup_name && (
        <details open className="mb-3">
          <summary className="text-xs font-semibold text-accent cursor-pointer hover:text-accent/80 select-none px-3 py-2 rounded-md bg-bg border border-border/30">
            {s.setup_name}
          </summary>
          <div className="px-3 py-2 rounded-b-md bg-bg border-x border-b border-border/30 -mt-1">
            {Array.isArray(s.rationale) && s.rationale.length > 0 ? (
              <ol className="space-y-1 pt-1">
                {s.rationale.map((line, i) => (
                  <li key={i} className="flex gap-2 text-xs text-text-dim leading-snug">
                    <span className="text-muted shrink-0 w-4 text-right">{i + 1}.</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <span className="text-xs text-muted">No rationale recorded</span>
            )}
          </div>
        </details>
      )}

      {/* ── Scale-in Entries ───────────────────────────────────── */}
      {s.scale_entries?.length > 0 && (
        <div className="mb-3 rounded-md bg-bg border border-border/30 overflow-hidden">
          {/* Header row */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/20">
            <span className="text-xs font-semibold text-muted tracking-wider">
              SCALED ENTRIES ({s.scale_entries.length}x LIMIT GTC)
            </span>
            {s.avg_entry && (
              <span className="text-xs text-accent font-mono">
                avg ${Number(s.avg_entry).toLocaleString()}
              </span>
            )}
          </div>
          {/* Entry rows */}
          <div className="px-3 py-1.5 space-y-0.5">
            {s.scale_entries.map((e) => (
              <div key={e.index} className="flex items-center gap-2 text-xs">
                <span className="text-muted whitespace-nowrap shrink-0 w-14">
                  Entry {e.index}
                </span>
                <span className="font-mono text-text font-semibold">
                  ${Number(e.price).toLocaleString()}
                </span>
                <span className="text-border mx-1">·</span>
                <span className="text-text-dim">{e.size} units</span>
                <span className="text-muted ml-auto font-mono">${Number(e.value).toFixed(2)}</span>
              </div>
            ))}
          </div>
          {/* SL row */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border/20 text-xs">
            <span className="text-muted whitespace-nowrap">SL (below last entry)</span>
            <span className="text-negative font-semibold font-mono ml-auto">${s.sl?.toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* ── TP Levels ──────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-2 text-xs mb-3">
        <LevelCell label="Stop Loss"  value={`$${s.sl?.toLocaleString()}`}  color="text-negative" />
        <LevelCell label="TP1 (40%)"  value={`$${s.tp1?.toLocaleString()}`} color="text-positive" />
        <LevelCell label="TP2 (35%)"  value={`$${s.tp2?.toLocaleString()}`} color="text-positive" />
        <LevelCell label="TP3 (25%)"  value={`$${s.tp3?.toLocaleString()}`} color="text-positive" />
      </div>

      {/* ── Position Info ──────────────────────────────────────── */}
      <div className="flex items-center gap-4 text-xs text-muted mb-3">
        <span>Size: <span className="text-text">{s.position_size}</span></span>
        <span>Value: <span className="text-text">${s.position_value?.toFixed(2)}</span></span>
        <span>Max risk: <span className="text-negative">${s.risk_dollars?.toFixed(2)}</span></span>
      </div>

      {/* ── Technical Details (collapsible) ────────────────────── */}
      {s.inputs && (
        <details className="mb-3">
          <summary className="text-xs text-muted cursor-pointer hover:text-text select-none">
            View technical data
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-text-dim">
            {s.inputs.technical && (
              <>
                <DataRow label="EMA200 D" value={n(s.inputs.technical.ema200d, 0)} />
                <DataRow label="EMA21 W"  value={n(s.inputs.technical.ema21w,  0)} />
                <DataRow label="RSI W"    value={n(s.inputs.technical.rsiW,    1)} />
                {s.inputs.technical.stochRsiW && (
                  <DataRow
                    label="StochRSI W"
                    value={`K:${n(s.inputs.technical.stochRsiW.k, 1)} D:${n(s.inputs.technical.stochRsiW.d, 1)}`}
                  />
                )}
                {s.inputs.technical.macd && (
                  <DataRow label="MACD W hist" value={n(s.inputs.technical.macd.histogram, 0)} />
                )}
              </>
            )}
            {s.inputs.onchain && (
              <>
                <DataRow label="Funding" value={n(s.inputs.onchain.funding, 4)} />
                <DataRow label="OI"      value={s.inputs.onchain.openInterest?.formatted} />
              </>
            )}
            {s.inputs.macro?.fearGreed && (
              <DataRow
                label="Fear & Greed"
                value={`${s.inputs.macro.fearGreed.value} (${s.inputs.macro.fearGreed.classification ?? ""})`}
              />
            )}
            {s.inputs.allSetups?.length > 1 && (
              <div className="col-span-2 mt-1 pt-1 border-t border-border/20">
                <span className="text-muted">Other active setups: </span>
                <span>
                  {s.inputs.allSetups.slice(1).map((st) =>
                    `${st.id} (${st.confidence}%)`
                  ).join(", ")}
                </span>
              </div>
            )}
          </div>
        </details>
      )}

      {/* ── Action Buttons ─────────────────────────────────────── */}
      <div className="flex gap-2">
        <button
          onClick={onApprove}
          disabled={!!loading}
          className="flex-1 py-2 rounded bg-positive/20 text-positive border border-positive/40 text-xs font-bold hover:bg-positive/30 transition-colors disabled:opacity-50"
        >
          {loading === "approve" ? "Executing..." : "APPROVE"}
        </button>
        <button
          onClick={onReject}
          disabled={!!loading}
          className="flex-1 py-2 rounded bg-negative/10 text-negative border border-negative/30 text-xs font-bold hover:bg-negative/20 transition-colors disabled:opacity-50"
        >
          {loading === "reject" ? "..." : "REJECT"}
        </button>
      </div>

      {error && (
        <div className="mt-2 px-3 py-2 rounded bg-negative/10 border border-negative/30 text-xs text-negative">
          Error: {error}
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────

function n(v, decimals = 2) {
  const num = parseFloat(v);
  return isNaN(num) ? "—" : num.toFixed(decimals);
}

// ── Sub-components ─────────────────────────────────────────────

function DirectionBadge({ direction }) {
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-bold ${
        direction === "LONG"
          ? "bg-positive/20 text-positive"
          : "bg-negative/20 text-negative"
      }`}
    >
      {direction}
    </span>
  );
}

function ConfidenceBadge({ score }) {
  const color =
    score >= 80 ? "text-positive bg-positive/20" :
    score >= 60 ? "text-accent bg-accent/20"     :
                  "text-muted bg-muted/20";
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${color}`}>
      {score}%
    </span>
  );
}

function LevelCell({ label, value, color = "text-text", highlight = false }) {
  return (
    <div className={`rounded p-2 text-center ${highlight ? "bg-accent/10 border border-accent/20" : "bg-bg"}`}>
      <div className="text-muted text-xs mb-0.5">{label}</div>
      <div className={`font-semibold text-xs ${color}`}>{value ?? "—"}</div>
    </div>
  );
}

function DataRow({ label, value }) {
  return (
    <>
      <span className="text-muted">{label}:</span>
      <span className="text-text">{value ?? "—"}</span>
    </>
  );
}
