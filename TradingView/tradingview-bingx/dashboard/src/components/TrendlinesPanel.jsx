import React, { useEffect, useRef, useState, useCallback } from "react";
import { createChart, LineStyle } from "lightweight-charts";

const SYMBOLS = [
  { id: "BTCUSDC", label: "BTC/USDC" },
  { id: "ETHUSDC", label: "ETH/USDC" },
  { id: "BTCUSDT", label: "BTC/USDT" },
  { id: "ETHUSDT", label: "ETH/USDT" },
];

const TIMEFRAMES = [
  { id: "30", label: "M30" },
  { id: "60", label: "H1" },
  { id: "240", label: "H4" },
  { id: "D", label: "D" },
  { id: "W", label: "W" },
];

const STATE_STYLES = {
  valid: { label: "Vigente", color: "text-muted" },
  approaching: { label: "Aproximando", color: "text-warning" },
  touching: { label: "Tocando", color: "text-accent" },
  broken: { label: "Rompida", color: "text-negative" },
  retesting: { label: "Retestando", color: "text-warning" },
};

/**
 * Painel isolado de trendlines — NÃO integrado ao scoring ainda.
 * Objetivo: validar visualmente se as linhas que o módulo detecta
 * batem com o que um trader humano desenharia, antes de plugar em signals.js.
 */
export function TrendlinesPanel() {
  const [symbol, setSymbol] = useState("BTCUSDC");
  const [timeframe, setTimeframe] = useState("240");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastFetchedAt, setLastFetchedAt] = useState(null);

  const fetchData = useCallback(async (fresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/trendlines/${symbol}?timeframe=${timeframe}${fresh ? "&fresh=1" : ""}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao buscar trendlines");
      setData(json);
      setLastFetchedAt(Date.now());
    } catch (err) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="space-y-5">
      {/* ── Controles ────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-card">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1">
            {SYMBOLS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSymbol(s.id)}
                className={`px-3 py-1.5 text-xs rounded border transition-colors ${symbol === s.id
                    ? "border-accent text-accent bg-accent/10"
                    : "border-border text-muted hover:text-text"
                  }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.id}
                onClick={() => setTimeframe(tf.id)}
                className={`px-3 py-1.5 text-xs font-mono rounded border transition-colors ${timeframe === tf.id
                    ? "border-accent text-accent bg-accent/10"
                    : "border-border text-muted hover:text-text"
                  }`}
              >
                {tf.label}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <button
            onClick={() => fetchData(true)}
            disabled={loading}
            className="px-4 py-1.5 text-xs border border-border text-muted rounded hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
          >
            {loading ? "Carregando…" : "Atualizar"}
          </button>
        </div>
        {lastFetchedAt && !loading && (
          <div className="mt-2 text-[10px] text-muted-dim font-mono">
            Último fetch: {new Date(lastFetchedAt).toLocaleTimeString()}
            {data?.cached && ` · cache (${Math.round((data.cachedAgeMs ?? 0) / 1000)}s)`}
            {data?.atr && ` · ATR(14): ${data.atr.toFixed(2)}`}
            {data?.barCount && ` · ${data.barCount} barras`}
          </div>
        )}
        {error && (
          <div className="mt-3 text-xs text-negative px-3 py-2 rounded border border-negative/30 bg-negative/5">
            Erro: {error}
          </div>
        )}
      </div>

      {/* ── Resumo das linhas ──────────────────────────────── */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <LineSummary title="LTA (suporte ascendente)" line={data.lines?.lta} price={data.price} kind="LTA" />
          <LineSummary title="LTB (resistência descendente)" line={data.lines?.ltb} price={data.price} kind="LTB" />
        </div>
      )}

      {/* ── Chart ──────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-card">
        <h2 className="text-xs text-muted tracking-[0.15em] font-medium mb-4">
          GRÁFICO — {SYMBOLS.find(s => s.id === symbol)?.label} · {TIMEFRAMES.find(t => t.id === timeframe)?.label}
        </h2>
        {data
          ? <TrendlinesChart data={data} />
          : <div className="h-[400px] flex items-center justify-center text-muted text-sm">
            {loading ? "Carregando dados…" : "Sem dados."}
          </div>}
      </div>

      {/* ── Nota explicativa ────────────────────────────────── */}
      <div className="text-[10px] text-muted-dim px-2">
        Modulo isolado de trendlines. Ainda não alimenta o scoring de sinais —
        use este painel pra validar visualmente se as linhas batem com o que você
        desenharia no TradingView. Sinais detectados aqui serão plugados no
        signals.js só depois da validação.
      </div>
    </div>
  );
}

// ── Cartão com resumo de uma linha ─────────────────────────────
function LineSummary({ title, line, price, kind }) {
  if (!line) {
    return (
      <div className="bg-card border border-border rounded-xl p-5 shadow-card">
        <h3 className="text-xs text-muted tracking-[0.15em] font-medium mb-3">{title}</h3>
        <p className="text-xs text-muted-dim">Nenhuma linha detectada com pivots suficientes.</p>
      </div>
    );
  }

  const stateStyle = STATE_STYLES[line.state] ?? { label: line.state, color: "text-muted" };
  const distPct = (line.distancePct * 100).toFixed(2);
  const isLong = kind === "LTA";
  const distanceDir = isLong
    ? (line.distance >= 0 ? "acima" : "abaixo")
    : (line.distance >= 0 ? "acima" : "abaixo");

  const signalLabel = line.signal
    ? {
      "3rd_touch_long": "3º toque LONG — candidato",
      "3rd_touch_short": "3º toque SHORT — candidato",
      "break_retest_long": "Break + reteste LONG",
      "break_retest_short": "Break + reteste SHORT",
    }[line.signal] ?? line.signal
    : null;

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-card">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-xs text-muted tracking-[0.15em] font-medium">{title}</h3>
        <span className={`text-xs font-mono font-bold tracking-wider uppercase ${stateStyle.color}`}>
          {stateStyle.label}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <Stat label="Valor agora" value={`$${line.priceAtNow.toFixed(2)}`} />
        <Stat label="Distância" value={`${distPct}% (${distanceDir})`} />
        <Stat label="Toques" value={`${line.touches}`} />
        <Stat label="Slope" value={`${line.slope >= 0 ? "+" : ""}${line.slope.toFixed(4)}/bar`} />
      </div>

      {line.break && (
        <div className="mt-3 text-[10px] text-negative/80 font-mono">
          Rompida {line.break.retested ? `e retestada` : `(sem reteste ainda)`}
        </div>
      )}

      {signalLabel && (
        <div className={`mt-3 text-xs px-3 py-2 rounded border font-medium ${line.signal.includes("long") ? "border-positive/40 bg-positive/10 text-positive"
            : "border-negative/40 bg-negative/10 text-negative"
          }`}>
          Sinal: {signalLabel}
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-border text-[10px] text-muted-dim font-mono grid grid-cols-2 gap-1">
        <div>P1: ${line.p1.price.toFixed(2)} · {new Date(line.p1.time * 1000).toISOString().slice(0, 10)}</div>
        <div>P2: ${line.p2.price.toFixed(2)} · {new Date(line.p2.time * 1000).toISOString().slice(0, 10)}</div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-[10px] text-muted-dim uppercase tracking-wider">{label}</div>
      <div className="text-text font-mono">{value}</div>
    </div>
  );
}

// ── Chart com candles + linhas ─────────────────────────────────
function TrendlinesChart({ data }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !data?.bars?.length) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 440,
      layout: {
        background: { color: "#1A1A24" },
        textColor: "#9CA3AF",
      },
      grid: {
        vertLines: { color: "#2A2A3A" },
        horzLines: { color: "#2A2A3A" },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: "#2A2A3A" },
      timeScale: { borderColor: "#2A2A3A", timeVisible: true, secondsVisible: false },
    });

    // Candles
    const candles = chart.addCandlestickSeries({
      upColor: "#22C55E",
      downColor: "#EF4444",
      borderUpColor: "#22C55E",
      borderDownColor: "#EF4444",
      wickUpColor: "#22C55E",
      wickDownColor: "#EF4444",
    });
    // Filtro defensivo: lightweight-charts quebra se algum item for null
    // ou tiver time inválido ("Cannot use 'in' operator to search for
    // '_internal_timestamp' in null"). Melhor descartar que travar a UI.
    const safeBars = (data.bars ?? [])
      .filter((b) =>
        b &&
        Number.isFinite(b.time) &&
        Number.isFinite(b.open) &&
        Number.isFinite(b.high) &&
        Number.isFinite(b.low) &&
        Number.isFinite(b.close)
      )
      .map((b) => ({
        time: b.time,
        open: b.open, high: b.high, low: b.low, close: b.close,
      }));
    if (!safeBars.length) return; // sem barras válidas, aborta render
    candles.setData(safeBars);

    // LTA (verde) — draw como linha passando pelos 2 pivots e estendendo até o fim
    if (data.lines?.lta?.drawPoints) {
      const ltaLine = chart.addLineSeries({
        color: "#22C55E",
        lineWidth: 2,
        lineStyle: data.lines.lta.state === "broken" ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      const ltaPoints = (data.lines.lta.drawPoints ?? [])
        .filter((p) => p && Number.isFinite(p.time) && Number.isFinite(p.price))
        .map((p) => ({ time: p.time, value: p.price }))
        // Remove duplicated times (lightweight-charts exige times estritamente crescentes)
        .filter((p, idx, arr) => idx === 0 || p.time > arr[idx - 1].time);
      if (ltaPoints.length >= 2) ltaLine.setData(ltaPoints);
    }

    // LTB (vermelho)
    if (data.lines?.ltb?.drawPoints) {
      const ltbLine = chart.addLineSeries({
        color: "#EF4444",
        lineWidth: 2,
        lineStyle: data.lines.ltb.state === "broken" ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      const ltbPoints = (data.lines.ltb.drawPoints ?? [])
        .filter((p) => p && Number.isFinite(p.time) && Number.isFinite(p.price))
        .map((p) => ({ time: p.time, value: p.price }))
        .filter((p, idx, arr) => idx === 0 || p.time > arr[idx - 1].time);
      if (ltbPoints.length >= 2) ltbLine.setData(ltbPoints);
    }

    // Markers nos pivots detectados (opcional, leves)
    const markers = [];
    (data.pivots?.lows ?? []).forEach((p) => {
      if (!p || !Number.isFinite(p.time)) return;
      markers.push({
        time: p.time,
        position: "belowBar",
        color: "#22C55E",
        shape: "arrowUp",
        size: 0.6,
      });
    });
    (data.pivots?.highs ?? []).forEach((p) => {
      if (!p || !Number.isFinite(p.time)) return;
      markers.push({
        time: p.time,
        position: "aboveBar",
        color: "#EF4444",
        shape: "arrowDown",
        size: 0.6,
      });
    });
    markers.sort((a, b) => a.time - b.time);
    if (markers.length) candles.setMarkers(markers);

    chart.timeScale().fitContent();

    const resize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.remove();
    };
  }, [data]);

  return <div ref={containerRef} className="w-full" />;
}