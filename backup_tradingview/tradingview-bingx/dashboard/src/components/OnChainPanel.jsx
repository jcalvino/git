// On-Chain & Market Metrics Panel
// Data refreshed every 5 min by the scanner via /api/market-metrics.
// Sources: CoinGecko (dominance), BingX (funding), bitcoinmagazinepro.com (realized, CVDD, STH).

const COINGLASS_LIQ_URL =
  "https://www.coinglass.com/pt/pro/futures/LiquidationHeatMap?coin=BTC";

export function OnChainPanel({ overview, marketMetrics }) {
  const m    = marketMetrics ?? {};
  const fund = m.funding ?? {};
  const sth  = m.sth     ?? null;
  const updatedAt = m.updatedAt
    ? new Date(m.updatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : null;

  const btcPrice = overview?.prices?.BTCUSDT ?? null;

  return (
    <div className="space-y-4">

      {/* Update timestamp */}
      {updatedAt && (
        <p className="text-xs text-muted text-right">
          Atualizado às {updatedAt} · próxima atualização em até 5 min (scanner)
        </p>
      )}
      {!updatedAt && (
        <p className="text-xs text-yellow-400/70 text-right">
          Aguardando primeiro scan do scanner…
        </p>
      )}

      {/* Row 1: Dominance + Funding Rates */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <MetricCard
          label="BTC Dominance"
          value={m.btcDominance != null ? `${m.btcDominance}%` : "—"}
          color={
            m.btcDominance == null ? "text-muted"
            : m.btcDominance >= 55  ? "text-positive"
            : m.btcDominance >= 45  ? "text-accent"
            : "text-negative"
          }
          note={
            m.btcDominance == null ? "Aguardando scan"
            : m.btcDominance >= 60  ? "Alta dominância — alts em sofrimento"
            : m.btcDominance >= 50  ? "BTC lidera o mercado"
            : "Rotação para alts em curso"
          }
          source="CoinGecko"
        />

        <FundingCard label="Funding Rate BTC" data={fund.btc} />
        <FundingCard label="Funding Rate ETH" data={fund.eth} />
      </div>

      {/* Row 2: On-chain price levels */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <PriceLevelCard
          label="STH Realized Price"
          price={sth?.price}
          currentPrice={btcPrice}
          priceAbove={sth?.priceAbove}
          note={sth?.convergenceStatus}
          isNear={sth?.isNearLine}
          isConverging={sth?.isConverging}
          source={sth?.source ?? "bitcoinmagazinepro"}
          tooltip="Preço médio de custo dos holders de curto prazo (< 155 dias). Proximidade sinaliza Setup 2."
        />
        <PriceLevelCard
          label="Realized Price"
          price={m.realizedPrice}
          currentPrice={btcPrice}
          priceAbove={btcPrice != null && m.realizedPrice != null ? btcPrice > m.realizedPrice : null}
          note={
            m.realizedPrice == null ? null
            : btcPrice == null      ? null
            : btcPrice > m.realizedPrice
              ? "Preço acima → mercado no lucro médio (bullish)"
              : "Preço abaixo → maioria em perda (capitulação / oportunidade)"
          }
          source="bitcoinmagazinepro"
          tooltip="Média ponderada do preço de última movimentação de cada BTC. Suporte/resistência histórico forte."
        />
        <PriceLevelCard
          label="CVDD"
          price={m.cvdd}
          currentPrice={btcPrice}
          priceAbove={btcPrice != null && m.cvdd != null ? btcPrice > m.cvdd : null}
          note={
            m.cvdd == null ? "Adicione manualmente: rules.json → { \"cvdd\": <valor> }"
            : btcPrice == null ? null
            : btcPrice < m.cvdd * 1.1
              ? "⚡ Zona de fundo histórico — alta probabilidade de reversão"
              : `${(((btcPrice - m.cvdd) / m.cvdd) * 100).toFixed(1)}% acima do CVDD`
          }
          source="rules.json"
          tooltip="Coin Value Days Destroyed — proxy para fundos de mercado. Fonte: bitcoinmagazinepro / Glassnode."
        />
      </div>

      {/* Row 3: Liquidation Heat Map */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-xs font-medium text-text tracking-wider">
              MAPA CALOR DE LIQUIDAÇÕES BTC/USDT (Binance Perps)
            </h3>
            <p className="text-xs text-muted max-w-xl">
              Mostra onde estão concentradas as ordens de stop e liquidações no mercado futuro.
              Zonas de alta densidade são alvos de liquidação em cascata — o mercado tende a
              mover-se em direção a elas para acionar o efeito dominó.
            </p>
            <p className="text-xs text-muted">
              Fonte:{" "}
              <a
                href={COINGLASS_LIQ_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline underline-offset-2"
              >
                CoinGlass — Liquidation Heat Map
              </a>
            </p>
          </div>
          <a
            href={COINGLASS_LIQ_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 px-4 py-2 rounded border border-accent text-accent text-xs font-medium hover:bg-accent/10 transition-colors whitespace-nowrap"
          >
            Abrir Heat Map ↗
          </a>
        </div>
      </div>

      {/* Row 4: Fear & Greed from overview */}
      {overview?.stats?.fearGreed != null && (
        <FearGreedBanner value={overview.stats.fearGreed} />
      )}

    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function MetricCard({ label, value, note, color, source }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">{label}</span>
        {source && <span className="text-xs text-border">{source}</span>}
      </div>
      <div className={`text-2xl font-bold font-mono ${color ?? "text-text"}`}>{value}</div>
      {note && <div className="text-xs text-muted leading-relaxed">{note}</div>}
    </div>
  );
}

function FundingCard({ label, data }) {
  if (!data) {
    return (
      <div className="bg-card border border-border rounded-lg p-4 space-y-1">
        <div className="text-xs text-muted">{label}</div>
        <div className="text-2xl font-bold font-mono text-muted">—</div>
        <div className="text-xs text-muted">Aguardando scan</div>
      </div>
    );
  }

  const rate     = parseFloat(data.ratePct ?? "0");
  const isBull   = data.signal === "bullish";
  const isBear   = data.signal === "bearish";
  const color    = isBull ? "text-positive" : isBear ? "text-negative" : "text-text";
  const sign     = rate > 0 ? "+" : "";
  const signalTx = isBull
    ? "Shorts pagando longs — pressão de compra"
    : isBear
    ? "Longs pagando shorts — mercado alavancado long"
    : "Neutro — mercado equilibrado";

  return (
    <div className={`bg-card border rounded-lg p-4 space-y-1 ${
      isBull ? "border-positive/30" : isBear ? "border-negative/30" : "border-border"
    }`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">{label}</span>
        <span className="text-xs text-border">BingX</span>
      </div>
      <div className={`text-2xl font-bold font-mono ${color}`}>
        {sign}{data.ratePct}%
      </div>
      <div className="text-xs text-muted leading-relaxed">{signalTx}</div>
    </div>
  );
}

function PriceLevelCard({ label, price, currentPrice, priceAbove, note, isNear, isConverging, source, tooltip }) {
  const hasPrice = price != null && price > 0;
  const dist     = hasPrice && currentPrice
    ? (((currentPrice - price) / price) * 100).toFixed(2)
    : null;

  let borderColor = "border-border";
  let priceTx     = "text-text";
  if (isNear && isConverging) { borderColor = "border-yellow-500/50"; priceTx = "text-yellow-400"; }
  else if (isNear)             { borderColor = "border-yellow-500/30"; }

  return (
    <div className={`bg-card border rounded-lg p-4 space-y-1 ${borderColor}`} title={tooltip}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">{label}</span>
        {source && <span className="text-xs text-border">{source}</span>}
      </div>

      <div className={`text-2xl font-bold font-mono ${hasPrice ? priceTx : "text-muted"}`}>
        {hasPrice ? `$${Math.round(price).toLocaleString()}` : "—"}
      </div>

      {/* Distance from current price */}
      {dist !== null && (
        <div className={`text-xs font-mono ${
          parseFloat(dist) >= 0 ? "text-positive/80" : "text-negative/80"
        }`}>
          {parseFloat(dist) >= 0 ? "+" : ""}{dist}% do preço atual
          {priceAbove === true  && " (preço acima)"}
          {priceAbove === false && " (preço abaixo)"}
        </div>
      )}

      {note && (
        <div className="text-xs text-muted leading-relaxed border-t border-border/50 pt-1 mt-1">
          {note}
        </div>
      )}
    </div>
  );
}

function FearGreedBanner({ value }) {
  const label =
    value <= 20  ? "Medo Extremo"
    : value <= 40 ? "Medo"
    : value <= 60 ? "Neutro"
    : value <= 80 ? "Ganância"
    : "Ganância Extrema";

  const color =
    value <= 20  ? "text-negative border-negative/30 bg-negative/5"
    : value <= 40 ? "text-orange-400 border-orange-400/30 bg-orange-400/5"
    : value <= 60 ? "text-text border-border"
    : value <= 80 ? "text-yellow-400 border-yellow-400/30 bg-yellow-400/5"
    : "text-positive border-positive/30 bg-positive/5";

  const barWidth = `${value}%`;
  const barColor =
    value <= 20  ? "bg-negative"
    : value <= 40 ? "bg-orange-400"
    : value <= 60 ? "bg-accent"
    : value <= 80 ? "bg-yellow-400"
    : "bg-positive";

  return (
    <div className={`rounded-lg border p-4 ${color}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted">Fear &amp; Greed Index</span>
        <span className="text-xs text-border">CoinGlass</span>
      </div>
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-4xl font-bold font-mono">{value}</span>
        <span className="text-lg font-medium">{label}</span>
      </div>
      <div className="h-2 bg-border/30 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: barWidth }}
        />
      </div>
      <div className="flex justify-between mt-1 text-xs text-border">
        <span>0 Medo Extremo</span>
        <span>50 Neutro</span>
        <span>100 Ganância Extrema</span>
      </div>
    </div>
  );
}
