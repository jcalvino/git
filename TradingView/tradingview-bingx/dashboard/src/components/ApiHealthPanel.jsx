// ─────────────────────────────────────────────────────────────────
//  ApiHealthPanel — visual API health checker
//  Pings each known endpoint, shows latency + last payload preview.
//  Green < 300ms | Yellow 300–800ms | Red > 800ms | Grey = error
// ─────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from "react";

const ENDPOINTS = [
  { key: "health",         method: "GET",  path: "/api/health",          label: "Health",           extract: (d) => `mode=${d.mode} | capital=$${d.capital}` },
  { key: "overview",       method: "GET",  path: "/api/overview",        label: "Overview",         extract: (d) => `balance=$${d.balance?.total?.toFixed(2)} | openTrades=${d.openTrades?.length ?? 0}` },
  { key: "signals",        method: "GET",  path: "/api/signals/pending", label: "Signals (pending)",extract: (d) => `${Array.isArray(d) ? d.length : "?"} pending` },
  { key: "risk",           method: "GET",  path: "/api/risk/daily",      label: "Daily Risk",       extract: (d) => `pnl=$${d.dailyPnl} | limited=${d.limited}` },
  { key: "market-metrics", method: "GET",  path: "/api/market-metrics",  label: "Market Metrics",   extract: (d) => d.btc ? `BTC=$${d.btc?.price?.toLocaleString() ?? "?"} | F&G=${d.fearGreed?.value ?? "?"}` : "sem cache ainda" },
  { key: "monitors",       method: "GET",  path: "/api/monitors",        label: "Price Monitors",   extract: (d) => `${d.monitors?.length ?? 0} monitores ativos` },
  { key: "sth",            method: "GET",  path: "/api/sth-monitor",     label: "STH Monitor",      extract: (d) => d.sthPrice ? `STH=$${d.sthPrice?.toLocaleString()} | prox=${d.touchProximityPct?.toFixed(2)}%` : "indisponível" },
  { key: "stats",          method: "GET",  path: "/api/stats",           label: "Stats",            extract: (d) => `trades=${d.totalTrades ?? 0} | winRate=${d.winRate ?? "?"}%` },
  { key: "strategy",       method: "GET",  path: "/api/strategy",        label: "Strategy Config",  extract: (d) => `${Object.keys(d.setups ?? {}).length} setups carregados` },
  { key: "trades",         method: "GET",  path: "/api/trades?limit=5",  label: "Trade History",    extract: (d) => `${Array.isArray(d) ? d.length : "?"} registros` },
  { key: "errors",         method: "GET",  path: "/api/errors",          label: "Error Tracker",    extract: (d) => d.hasActive ? `⚠ ${d.errors?.length} erro(s) ativo(s)` : "sem erros ativos" },
  { key: "last-scan",      method: "GET",  path: "/api/signals/last-scan", label: "Last Scan",      extract: (d) => d.runAt ? `${d.results?.length ?? 0} símbolos em ${new Date(d.runAt).toLocaleTimeString("pt-BR")}` : "nenhum scan ainda" },
];

function latencyColor(ms, error) {
  if (error)    return { dot: "bg-negative",   bar: "bg-negative/30",  text: "text-negative",   label: "ERRO" };
  if (ms < 300) return { dot: "bg-positive",   bar: "bg-positive/30",  text: "text-positive",   label: `${ms}ms` };
  if (ms < 800) return { dot: "bg-yellow-400", bar: "bg-yellow-400/30",text: "text-yellow-400", label: `${ms}ms` };
  return         { dot: "bg-negative",   bar: "bg-negative/30",  text: "text-negative",   label: `${ms}ms` };
}

async function pingEndpoint(ep) {
  const start = performance.now();
  try {
    const res  = await fetch(ep.path, { method: ep.method });
    const ms   = Math.round(performance.now() - start);
    if (!res.ok) return { key: ep.key, ms, error: `HTTP ${res.status}`, preview: null };
    const data = await res.json();
    return { key: ep.key, ms, error: null, preview: ep.extract(data) };
  } catch (err) {
    return { key: ep.key, ms: null, error: err.message, preview: null };
  }
}

export function ApiHealthPanel() {
  const [results, setResults]   = useState({});
  const [checking, setChecking] = useState(false);
  const [lastRun, setLastRun]   = useState(null);

  const runChecks = useCallback(async () => {
    setChecking(true);
    const all = await Promise.all(ENDPOINTS.map(pingEndpoint));
    const map = {};
    for (const r of all) map[r.key] = r;
    setResults(map);
    setLastRun(new Date());
    setChecking(false);
  }, []);

  // Run once on mount
  useEffect(() => { runChecks(); }, [runChecks]);

  const ok    = Object.values(results).filter((r) => !r.error && r.ms < 800).length;
  const warn  = Object.values(results).filter((r) => !r.error && r.ms >= 300 && r.ms < 800).length;
  const fail  = Object.values(results).filter((r) => r.error  || r.ms >= 800).length;
  const total = ENDPOINTS.length;

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xs text-muted tracking-wider">API HEALTH</h2>
          <p className="text-xs text-muted/60 mt-0.5">
            {lastRun
              ? `Última verificação: ${lastRun.toLocaleTimeString("pt-BR")}`
              : "Verificando..."}
          </p>
        </div>

        {/* Summary badges */}
        <div className="flex items-center gap-2">
          {Object.keys(results).length > 0 && (
            <>
              <span className="text-xs px-2 py-0.5 rounded-full bg-positive/15 text-positive font-mono">
                {ok - warn} ok
              </span>
              {warn > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-400/15 text-yellow-400 font-mono">
                  {warn} lento
                </span>
              )}
              {fail > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-negative/15 text-negative font-mono">
                  {fail} erro
                </span>
              )}
            </>
          )}
          <button
            onClick={runChecks}
            disabled={checking}
            className="px-3 py-1.5 text-xs border border-accent text-accent rounded hover:bg-accent/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {checking ? (
              <>
                <span className="inline-block w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin" />
                Verificando...
              </>
            ) : (
              "↻ Verificar"
            )}
          </button>
        </div>
      </div>

      {/* Overall bar */}
      {Object.keys(results).length > 0 && (
        <div className="mb-4 h-1.5 rounded-full bg-border overflow-hidden flex">
          <div
            className="h-full bg-positive transition-all duration-500"
            style={{ width: `${((ok - warn) / total) * 100}%` }}
          />
          <div
            className="h-full bg-yellow-400 transition-all duration-500"
            style={{ width: `${(warn / total) * 100}%` }}
          />
          <div
            className="h-full bg-negative transition-all duration-500"
            style={{ width: `${(fail / total) * 100}%` }}
          />
        </div>
      )}

      {/* Endpoint grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
        {ENDPOINTS.map((ep) => {
          const r   = results[ep.key];
          const col = r ? latencyColor(r.ms, r.error) : null;

          return (
            <div
              key={ep.key}
              className={`rounded border px-3 py-2.5 flex items-start gap-2.5 transition-colors ${
                col ? col.bar : "border-border bg-border/20"
              } border-opacity-40`}
            >
              {/* Status dot */}
              <div className="mt-0.5 flex-shrink-0">
                {col ? (
                  <span className={`block w-2 h-2 rounded-full ${col.dot} ${!r.error && r.ms < 300 ? "shadow-sm shadow-positive/50" : ""}`} />
                ) : (
                  <span className="block w-2 h-2 rounded-full bg-muted/30 animate-pulse" />
                )}
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-medium text-text truncate">{ep.label}</span>
                  {col && (
                    <span className={`text-xs font-mono flex-shrink-0 ${col.text}`}>
                      {col.label}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted/70 mt-0.5 truncate font-mono">
                  {r
                    ? (r.error ? r.error : r.preview ?? "—")
                    : <span className="animate-pulse">...</span>
                  }
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
