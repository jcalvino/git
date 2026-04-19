import React, { useEffect, useState } from "react";

const API = "http://localhost:3001";

/**
 * Displays the result of the last scanner run:
 * - Which setups were evaluated per symbol
 * - Why no signal was generated (when no trades are pending)
 * - Macro context at the time of the scan
 * - Auto-refreshes every 60s
 */
export function ScanStatus() {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);

  const fetch_ = async () => {
    try {
      const res = await fetch(`${API}/api/signals/last-scan`);
      setData(await res.json());
    } catch {
      // API not reachable
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetch_();
    const id = setInterval(fetch_, 60_000);
    return () => clearInterval(id);
  }, []);

  if (loading) {
    return <div className="text-muted text-xs animate-pulse">Loading scan status...</div>;
  }

  if (!data?.runAt) {
    return (
      <div className="space-y-2">
        <p className="text-muted text-xs">No scan has been run yet.</p>
        <p className="text-xs text-text-dim">
          Run:{" "}
          <code className="text-accent bg-bg px-1 py-0.5 rounded">
            node src/bot/scanner.js --once
          </code>
        </p>
      </div>
    );
  }

  const allBelowThreshold = data.results.every(
    (r) => !r.direction || r.status === "BELOW_THRESHOLD" || r.status === "ERROR"
  );

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted">
          Last scan:{" "}
          <span className="text-text">
            {new Date(data.runAt).toLocaleString("en-US")}
          </span>
        </div>
        {data.capital && (
          <div className="text-xs">
            Capital:{" "}
            <span className="text-accent font-semibold">${data.capital.toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Macro context strip */}
      {data.macroContext && (
        <div className="px-3 py-2 rounded bg-bg border border-border/30 text-xs space-y-0.5">
          <div className="flex items-center gap-3">
            <span className="text-muted">Fear & Greed:</span>
            <FearGreedBadge value={data.macroContext.fearGreed?.value} label={data.macroContext.fearGreed?.label} />
            <span className="text-muted">Bias:</span>
            <span className="text-text-dim">{data.macroContext.bias ?? "—"}</span>
          </div>
          {data.macroContext.hasHighRisk && (
            <div className="text-negative">
              ⚠ High risk: {data.macroContext.warnings?.join(", ")}
            </div>
          )}
        </div>
      )}

      {/* Per-symbol results */}
      {data.results.map((r) => (
        <SymbolResult key={r.symbol} result={r} />
      ))}

      {/* Global "no signal" message */}
      {allBelowThreshold && data.results.length > 0 && (
        <div className="px-3 py-2 rounded bg-yellow-500/5 border border-yellow-500/20 text-xs text-yellow-400/80">
          No entry signal at the moment — all scanned assets are below the minimum
          confidence threshold. Next scan in up to 4h or run manually.
        </div>
      )}
    </div>
  );
}

function SymbolResult({ result: r }) {
  const [open, setOpen] = useState(false);
  const hasSignal = !!r.direction && r.status !== "BELOW_THRESHOLD";
  const isError   = r.status === "ERROR";

  return (
    <div
      className={`border rounded-lg px-3 py-2 text-xs ${
        hasSignal
          ? r.direction === "LONG"
            ? "border-positive/30 bg-positive/5"
            : "border-negative/30 bg-negative/5"
          : isError
          ? "border-negative/20 bg-negative/5"
          : "border-border/30 bg-bg"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-text">{r.symbol}</span>
          {hasSignal && (
            <span
              className={`px-1.5 py-0.5 rounded font-bold ${
                r.direction === "LONG"
                  ? "bg-positive/20 text-positive"
                  : "bg-negative/20 text-negative"
              }`}
            >
              {r.direction}
            </span>
          )}
          {!hasSignal && !isError && (
            <span className="text-muted">no signal</span>
          )}
          {isError && <span className="text-negative">error</span>}
        </div>
        <div className="flex items-center gap-2">
          {r.score > 0 && (
            <span className={`font-mono ${hasSignal ? "text-accent" : "text-muted"}`}>
              {r.score}%
            </span>
          )}
          {r.setup_name && (
            <span className="text-accent text-xs">{r.setup_name}</span>
          )}
          {r.rationale?.length > 0 && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="text-muted hover:text-text transition-colors"
            >
              {open ? "▲" : "▼"}
            </button>
          )}
        </div>
      </div>

      {/* Rationale */}
      {open && r.rationale?.length > 0 && (
        <ol className="mt-2 space-y-1 text-text-dim border-t border-border/20 pt-2">
          {r.rationale.map((line, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-muted w-4 shrink-0 text-right">{i + 1}.</span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function FearGreedBadge({ value, label }) {
  if (value === undefined) return <span className="text-muted">—</span>;
  const color =
    value < 25  ? "text-positive bg-positive/10" :
    value < 45  ? "text-green-400 bg-green-400/10" :
    value < 55  ? "text-yellow-400 bg-yellow-400/10" :
    value < 75  ? "text-orange-400 bg-orange-400/10" :
                  "text-negative bg-negative/10";

  return (
    <span className={`px-1.5 py-0.5 rounded font-semibold ${color}`}>
      {value} {label ? `(${label})` : ""}
    </span>
  );
}
