// ─────────────────────────────────────────────────────────────────
//  ScanResultsGrid — grid visual de todos os ativos analisados
//  Lê /api/signals/last-scan (lastScanSummary do scanner).
//  Independente do useLiveData / overview — não usa BingX API.
// ─────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from "react";

const API = "/api";

function timeAgo(isoStr) {
  if (!isoStr) return null;
  const diff = Math.floor((Date.now() - new Date(isoStr)) / 1000);
  if (diff < 60)  return `${diff}s atrás`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
  return `${Math.floor(diff / 3600)}h atrás`;
}

function scoreColor(score, hasSignal) {
  if (!hasSignal) return "text-muted";
  if (score >= 80) return "text-positive";
  if (score >= 65) return "text-yellow-400";
  return "text-orange-400";
}

// Human-readable short names for BingX non-crypto contract symbols
const SYMBOL_LABELS = {
  // Commodities — precious metals
  "NCCOGOLD2USD-USDT":          "Gold",
  "NCCOXAG2USD-USDT":           "Silver",
  "NCCOXPT2USD-USDT":           "Platinum",
  // Commodities — energy
  "NCCO7241OILBRENT2USD-USDT":  "Brent",
  "NCCO7241OILWTI2USD-USDT":    "WTI",
  "NCCO7241NATGAS2USD-USDT":    "NatGas",
  "NCCOGASOLINE2USD-USDT":      "Gasoline",
  // Commodities — agriculture
  "NCCOSOYBEANS2USD-USDT":      "Soybeans",
  "NCCOWHEAT2USD-USDT":         "Wheat",
  "NCCOCOCOA2USD-USDT":         "Cocoa",
  // Commodities — metals
  "NCCOCOPPER2USD-USDT":        "Copper",
  "NCCOALUMINIUM2USD-USDT":     "Aluminium",
  // Forex
  "NCFXEUR2USD-USDT":           "EUR/USD",
  // Stocks
  "NCSKTSLA2USD-USDT":          "TSLA",
  "NCSKNVDA2USD-USDT":          "NVDA",
  "NCSKGOOGL2USD-USDT":         "GOOGL",
  "NCSKAMZN2USD-USDT":          "AMZN",
  "NCSKMSFT2USD-USDT":          "MSFT",
  // Crypto exceptions
  "HYPEUSDT":                   "HYPE",
};

function symbolLabel(symbol) {
  if (!symbol) return "?";
  // Exact match first
  if (SYMBOL_LABELS[symbol]) return SYMBOL_LABELS[symbol];
  // Try with -USDT appended (in case stored without suffix)
  if (SYMBOL_LABELS[symbol + "-USDT"]) return SYMBOL_LABELS[symbol + "-USDT"];
  // NCC*/NCFX*/NCSK* fallback: strip prefix + "2USD-USDT" suffix
  // e.g. "NCCO7241OILBRENT2USD-USDT" → "OILBRENT" → "Brent" (handled above)
  // Generic fallback for any unrecognised NCC symbol:
  if (symbol.startsWith("NCC") || symbol.startsWith("NCF") || symbol.startsWith("NCS")) {
    // Strip known prefix patterns and suffix
    return symbol
      .replace(/^NCC[OFX]?/, "")   // remove NCCO / NCFX / NCCO prefix
      .replace(/^SK/, "")           // NCSK → remove SK
      .replace(/7241/, "")          // remove 7241 marker
      .replace(/2USD.*$/, "")       // remove "2USD-USDT" suffix
      .replace(/^OIL/, "")          // OILBRENT → BRENT (already mapped, but just in case)
      || symbol.slice(0, 8);
  }
  // Crypto: strip trailing -USDT or USDT
  return symbol.replace(/-USDT$/, "").replace(/USDT$/, "");
}

// Short label shown on the card for a setup name
function setupShortName(name) {
  if (!name) return null;
  if (name.includes("EMA Pullback"))       return "EMA PB";
  if (name.includes("STH"))                return "STH";
  if (name.includes("Rompimento") || name.includes("S/R")) return "S/R";
  if (name.includes("Open Interest"))      return "OI";
  if (name.includes("Liquidação") || name.includes("Liquidation")) return "LIQ";
  // Fallback: first word after "—"
  const after = name.split("—")[1]?.trim();
  return after ? after.split(" ").slice(0, 2).join(" ") : name.slice(0, 6);
}

function SymbolCard({ result }) {
  const [expanded, setExpanded] = useState(false);

  const hasSignal = !!result.direction && result.status !== "BELOW_THRESHOLD" && result.status !== "ERROR" && result.status !== "DISABLED";
  const isError   = result.status === "ERROR";
  const isDisabled = result.status === "DISABLED";
  const isLong    = result.direction === "LONG";

  let borderClass = "border-border/40 bg-card";
  let dotClass    = "bg-muted/40";

  if (hasSignal) {
    borderClass = isLong
      ? "border-positive/40 bg-positive/5"
      : "border-negative/40 bg-negative/5";
    dotClass = isLong ? "bg-positive" : "bg-negative";
  } else if (isError) {
    borderClass = "border-negative/20 bg-negative/5";
    dotClass    = "bg-negative/60";
  } else if (isDisabled) {
    borderClass = "border-border/20 bg-bg/40 opacity-40";
    dotClass    = "bg-muted/20";
  }

  return (
    <div className={`border rounded-lg p-2.5 flex flex-col gap-1.5 transition-colors ${borderClass}`}>
      {/* Row 1: direction badge (top) + score */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotClass}`} />
          {hasSignal ? (
            <span className={`text-xs font-bold px-1 py-0 rounded leading-4 ${
              isLong ? "bg-positive/20 text-positive" : "bg-negative/20 text-negative"
            }`}>
              {result.direction}
            </span>
          ) : (
            <span className="text-xs text-muted/40">—</span>
          )}
        </div>

        {/* Score */}
        {result.score > 0 && (
          <span className={`text-xs font-mono font-semibold ${scoreColor(result.score, hasSignal)}`}>
            {result.score}%
          </span>
        )}
      </div>

      {/* Row 2: symbol name */}
      <div className="text-xs font-semibold text-text tracking-wide leading-none">
        {symbolLabel(result.symbol)}
      </div>

      {/* Row 3: setup name or status */}
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs text-muted/70 truncate">
          {hasSignal
            ? setupShortName(result.setup_name) ?? "sinal"
            : isError
            ? "erro"
            : isDisabled
            ? "desativado"
            : "sem sinal"
          }
        </span>
        {/* Expand rationale button */}
        {result.rationale?.length > 0 && !isDisabled && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-muted/50 hover:text-muted text-xs leading-none"
            title="Ver detalhes"
          >
            {expanded ? "▲" : "▼"}
          </button>
        )}
      </div>

      {/* Rationale drawer */}
      {expanded && result.rationale?.length > 0 && (
        <div className="mt-1 pt-1.5 border-t border-border/30 space-y-1">
          {result.rationale.map((line, i) => (
            <p key={i} className="text-xs text-muted/80 leading-snug">
              {line}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function ScanResultsGrid() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [age, setAge]         = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/signals/last-scan`);
      const json = await res.json();
      setData(json);
      setAge(timeAgo(json.runAt));
    } catch { /* server offline */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 60_000);
    // Update relative time label every 15s without re-fetching
    const ticker = setInterval(() => {
      setData((prev) => { setAge(timeAgo(prev?.runAt)); return prev; });
    }, 15_000);
    return () => { clearInterval(poll); clearInterval(ticker); };
  }, [load]);

  // Counts
  const signals  = data?.results?.filter((r) => r.direction && r.status !== "BELOW_THRESHOLD" && r.status !== "ERROR" && r.status !== "DISABLED") ?? [];
  const errors   = data?.results?.filter((r) => r.status === "ERROR") ?? [];
  const noSignal = data?.results?.filter((r) => !r.direction || r.status === "BELOW_THRESHOLD") ?? [];

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-xs text-muted tracking-wider">ÚLTIMA ANÁLISE — ATIVOS</h2>
          {data?.runAt && (
            <p className="text-xs text-muted/60 mt-0.5">
              {age} · {new Date(data.runAt).toLocaleTimeString("pt-BR")}
              {data.capital && (
                <> · capital <span className="text-accent font-mono">${data.capital.toFixed(2)}</span></>
              )}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Summary badges */}
          {signals.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-positive/15 text-positive font-mono">
              {signals.length} sign{signals.length > 1 ? "s" : ""}
            </span>
          )}
          {errors.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-negative/15 text-negative font-mono">
              {errors.length} erro{errors.length > 1 ? "s" : ""}
            </span>
          )}
          <button
            onClick={load}
            className="px-3 py-1.5 text-xs border border-border text-muted rounded hover:border-accent hover:text-accent transition-colors"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Macro strip */}
      {data?.macroContext && (
        <div className="mb-3 px-3 py-2 rounded bg-bg border border-border/30 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="text-muted">Fear & Greed:</span>
          <FearGreedBadge value={data.macroContext.fearGreed?.value} label={data.macroContext.fearGreed?.label} />
          <span className="text-muted">Viés:</span>
          <span className="text-text">{data.macroContext.bias ?? "—"}</span>
          {data.macroContext.hasHighRisk && (
            <span className="text-negative font-semibold">
              ⚠ Risco alto: {data.macroContext.warnings?.join(", ")}
            </span>
          )}
        </div>
      )}

      {/* States */}
      {loading && (
        <p className="text-xs text-muted animate-pulse">Carregando...</p>
      )}

      {!loading && !data?.runAt && (
        <div className="text-xs text-muted space-y-1">
          <p>Nenhum scan executado ainda.</p>
          <p>Execute: <code className="text-accent">node src/bot/scanner.js --once</code></p>
        </div>
      )}

      {/* Asset grid */}
      {data?.results?.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-9 gap-2">
          {data.results.map((r) => (
            <SymbolCard key={r.symbol} result={r} />
          ))}
        </div>
      )}

      {/* Daily limit warning */}
      {data?.dailyLimited && (
        <div className="mt-3 px-3 py-2 rounded bg-yellow-500/10 border border-yellow-500/30 text-xs text-yellow-400">
          ⚠ Limite diário atingido — sem novas ordens hoje.
        </div>
      )}
    </div>
  );
}

function FearGreedBadge({ value, label }) {
  if (value === undefined || value === null) return <span className="text-muted">—</span>;
  const cls =
    value < 25 ? "text-positive bg-positive/10"       :
    value < 45 ? "text-green-400 bg-green-400/10"     :
    value < 55 ? "text-yellow-400 bg-yellow-400/10"   :
    value < 75 ? "text-orange-400 bg-orange-400/10"   :
                 "text-negative bg-negative/10";
  return (
    <span className={`px-1.5 py-0.5 rounded font-semibold ${cls}`}>
      {value}{label ? ` (${label})` : ""}
    </span>
  );
}
