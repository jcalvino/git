// ─────────────────────────────────────────────────────────────────
//  WatchlistPanel — "Quase entrou"
//
//  Lista sinais onde algum setup realmente triggerou mas a confiança
//  ficou abaixo de MIN_SCORE. Esses sinais são persistidos em SQLite
//  com status=BELOW_THRESHOLD e servem pra:
//    1. Ver visualmente quantos trades perdemos por conservadorismo
//    2. Calibrar pesos dos modifiers e MIN_SCORE via backtest
//
//  Fonte: GET /api/signals/watchlist (últimos 50).
// ─────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from "react";

const API = "/api";

function timeAgo(isoStr) {
  if (!isoStr) return null;
  const diff = Math.floor((Date.now() - new Date(isoStr)) / 1000);
  if (diff < 60)   return `${diff}s atrás`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  return `${Math.floor(diff / 86400)}d atrás`;
}

function fmtPrice(p) {
  if (p == null) return "—";
  if (p >= 1000)  return `$${p.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (p >= 1)     return `$${p.toFixed(2)}`;
  return `$${p.toFixed(4)}`;
}

function shortSymbol(sym) {
  if (!sym) return "?";
  return sym.replace(/-USDT$/, "").replace(/USDT$/, "").replace(/USDC$/, "");
}

function WatchlistCard({ signal }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = signal.direction === "LONG";

  // rationale vem como array JSON (parseSignalRow já desserializa).
  const rationale = Array.isArray(signal.rationale)
    ? signal.rationale
    : (typeof signal.rationale === "string"
        ? (() => { try { return JSON.parse(signal.rationale); } catch { return []; } })()
        : []);

  // Gap entre score atual e o MIN_SCORE (calibração visual).
  // MIN_SCORE não vem via API — hardcode o fallback pro valor atual
  // do strategy.js (65). Se mudarmos lá, atualizar aqui também.
  const MIN_SCORE = 65;
  const gap = MIN_SCORE - (signal.score ?? 0);

  return (
    <div className={`border rounded-lg p-3 transition-colors ${
      isLong
        ? "border-positive/25 bg-positive/5"
        : "border-negative/25 bg-negative/5"
    }`}>
      {/* Header: symbol + direction + score */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
            isLong ? "bg-positive/20 text-positive" : "bg-negative/20 text-negative"
          }`}>
            {signal.direction}
          </span>
          <span className="text-sm font-semibold text-text">
            {shortSymbol(signal.symbol)}
          </span>
          {signal.setup_id && (
            <span className="text-xs text-muted/70 px-1.5 py-0.5 rounded bg-bg/50 border border-border/30">
              {signal.setup_id}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-semibold text-orange-400">
            {signal.score}%
          </span>
          {gap > 0 && (
            <span className="text-xs text-muted/60 font-mono">
              (−{gap} p/ {MIN_SCORE})
            </span>
          )}
        </div>
      </div>

      {/* Price levels */}
      <div className="grid grid-cols-4 gap-2 text-xs font-mono mb-2">
        <div>
          <div className="text-muted/50 text-xs">Entry</div>
          <div className="text-text">{fmtPrice(signal.entry)}</div>
        </div>
        <div>
          <div className="text-muted/50 text-xs">SL</div>
          <div className="text-negative/80">{fmtPrice(signal.sl)}</div>
        </div>
        <div>
          <div className="text-muted/50 text-xs">TP1</div>
          <div className="text-positive/80">{fmtPrice(signal.tp1)}</div>
        </div>
        <div>
          <div className="text-muted/50 text-xs">TP3</div>
          <div className="text-positive/80">{fmtPrice(signal.tp3)}</div>
        </div>
      </div>

      {/* Footer: timestamp + expand button */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted/60">
          #{signal.id} · {timeAgo(signal.created_at)}
        </span>
        {rationale.length > 0 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-muted/70 hover:text-accent transition-colors"
          >
            {expanded ? "▲ breakdown" : "▼ breakdown"}
          </button>
        )}
      </div>

      {/* Rationale drawer */}
      {expanded && rationale.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border/30 space-y-1">
          {rationale.map((line, i) => (
            <p key={i} className="text-xs text-muted/80 leading-snug">
              · {line}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function WatchlistPanel() {
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/signals/watchlist?limit=20`);
      const json = await res.json();
      setSignals(Array.isArray(json) ? json : []);
      setLastFetch(new Date());
    } catch { /* server offline */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 60_000);
    return () => clearInterval(poll);
  }, [load]);

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-xs text-muted tracking-wider">WATCHLIST — QUASE ENTROU</h2>
          <p className="text-xs text-muted/60 mt-0.5">
            Setups que dispararam mas ficaram abaixo do score mínimo.
            {lastFetch && (
              <> · atualizado {timeAgo(lastFetch.toISOString())}</>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {signals.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400 font-mono">
              {signals.length}
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

      {/* States */}
      {loading && (
        <p className="text-xs text-muted animate-pulse">Carregando...</p>
      )}

      {!loading && signals.length === 0 && (
        <div className="text-xs text-muted/60 py-4 text-center">
          Nenhum sinal na watchlist.
          <p className="text-muted/40 mt-1">
            Quando um setup triggerar abaixo de {65}% o sinal aparece aqui.
          </p>
        </div>
      )}

      {/* Signal list */}
      {!loading && signals.length > 0 && (
        <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
          {signals.map((s) => (
            <WatchlistCard key={s.id} signal={s} />
          ))}
        </div>
      )}
    </div>
  );
}

export default WatchlistPanel;
